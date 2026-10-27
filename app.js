// 지역 정보 (기상단기예보 격자 좌표 + 위경도)
const REGIONS = {
    세종: { nx: 60, ny: 127, lat: 36.48, lon: 127.29 },
    대전: { nx: 68, ny: 100, lat: 36.32, lon: 127.43 },
    태안: { nx: 52, ny: 38, lat: 36.95, lon: 126.37 },
    보령: { nx: 56, ny: 79, lat: 36.27, lon: 126.57 }
};

// 초기 가상 데이터
const initialTasks = [
    { title: "다중이용시설 안전점검", region: "세종", kind: "야외", owner: "김안전" },
    { title: "시민 안전체험 행사 운영", region: "보령", kind: "야외", owner: "이행사" },
    { title: "옥상 태양광 설비 점검", region: "태안", kind: "고소", owner: "박설비" },
    { title: "하천 수위계 확인", region: "대전", kind: "야외", owner: "최현장" },
    { title: "청사 외벽 간판 보수", region: "세종", kind: "고소", owner: "정시설" },
    { title: "비상연락 훈련", region: "대전", kind: "실내", owner: "한상황" }
];

const STORAGE_KEY = 'tasks';
const DEFAULT_REGION = '세종';

// 화면 상태
let weatherData = {};
let lastUpdated = null;
let dataSource = '';
let currentRegion = null;
let tickerTimer = null;

// ─────────────────────────────────────────────
// 현재 위치
// ─────────────────────────────────────────────

// 두 좌표 사이 거리(km)
function getDistanceKm(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const toRad = deg => deg * Math.PI / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
}

// 위경도에서 가장 가까운 지역 찾기
function findNearestRegion(lat, lon) {
    let nearest = DEFAULT_REGION;
    let minDistance = Infinity;

    for (const [region, info] of Object.entries(REGIONS)) {
        const distance = getDistanceKm(lat, lon, info.lat, info.lon);
        if (distance < minDistance) {
            minDistance = distance;
            nearest = region;
        }
    }

    return { region: nearest, distance: minDistance };
}

// 브라우저에서 현재 위치 받기
function getCurrentPosition() {
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
            reject(new Error('이 브라우저는 위치 기능을 지원하지 않습니다'));
            return;
        }
        navigator.geolocation.getCurrentPosition(
            position => resolve(position.coords),
            error => reject(error),
            { timeout: 8000, maximumAge: 300000 }
        );
    });
}

// 현재 위치로 기준 지역 정하기
async function detectCurrentRegion() {
    const statusEl = document.getElementById('locationStatus');
    statusEl.textContent = '현재 위치 확인 중…';

    try {
        const coords = await getCurrentPosition();
        const nearest = findNearestRegion(coords.latitude, coords.longitude);
        currentRegion = nearest.region;
        statusEl.textContent =
            `현재 위치 기준: ${nearest.region} (약 ${Math.round(nearest.distance)}km)`;
    } catch (e) {
        currentRegion = DEFAULT_REGION;
        statusEl.textContent = `위치를 확인할 수 없어 ${DEFAULT_REGION} 기준으로 봅니다`;
    }
}

// ─────────────────────────────────────────────
// 날씨 받기
// ─────────────────────────────────────────────

// Vercel 서버리스 함수에서 날씨 데이터 받기
async function fetchWeatherData() {
    try {
        const response = await fetch('/api/weather');
        if (!response.ok) throw new Error('API response error');

        const data = await response.json();
        if (data.error) throw new Error(data.error);

        dataSource = '기상청 단기예보';
        return data;
    } catch (e) {
        console.warn('서버 날씨 API 오류, Open-Meteo로 폴백:', e);
        dataSource = 'Open-Meteo 예보';
        return fetchWeatherDataOpenMeteo();
    }
}

// Open-Meteo API (폴백용)
async function fetchWeatherDataOpenMeteo() {
    const result = {};

    try {
        for (const [region, info] of Object.entries(REGIONS)) {
            const url = `https://api.open-meteo.com/v1/forecast?latitude=${info.lat}&longitude=${info.lon}&daily=temperature_2m_max,wind_speed_10m_max,precipitation_probability_max&timezone=Asia/Seoul`;

            const response = await fetch(url);
            if (!response.ok) throw new Error(`API error for ${region}`);

            const data = await response.json();
            const daily = data.daily;

            result[region] = {
                maxTemp: daily.temperature_2m_max[0],
                windSpeed: daily.wind_speed_10m_max[0],
                rainProbability: daily.precipitation_probability_max[0]
            };
        }
    } catch (e) {
        console.error('Open-Meteo API 오류:', e);
        dataSource = '날씨를 받지 못함';
    }

    return result;
}

// ?test=wind 파라미터 처리
function isWindTest() {
    return new URLSearchParams(window.location.search).get('test') === 'wind';
}

function applyTestParameters(data) {
    if (isWindTest()) {
        for (const region in data) {
            data[region].windSpeed = 12;
        }
    }
    return data;
}

// ─────────────────────────────────────────────
// 갱신 시각 표시
// ─────────────────────────────────────────────

// 'N분 전' 문구 만들기
function formatRelativeTime(timestamp) {
    if (!timestamp) return '아직 받지 않음';

    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return '방금 전';

    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}분 전`;

    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}시간 전`;

    return `${Math.floor(hours / 24)}일 전`;
}

// 시:분 문구 만들기
function formatClockTime(timestamp) {
    const date = new Date(timestamp);
    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
}

// 갱신 시각 칸 다시 그리기
function renderUpdatedAt() {
    const el = document.getElementById('weatherUpdated');
    if (!lastUpdated) {
        el.textContent = '';
        el.removeAttribute('title');
        return;
    }
    el.textContent = `${formatRelativeTime(lastUpdated)} 받음`;
    el.title = `${formatClockTime(lastUpdated)} 기준`;
}

// 출처 칸 다시 그리기
function renderSource() {
    const el = document.getElementById('weatherSource');
    el.textContent = '';

    const text = document.createElement('span');
    text.textContent = `${dataSource} (최고 기온 · 최대 풍속 · 강수확률)`;
    el.appendChild(text);

    if (isWindTest()) {
        const badge = document.createElement('span');
        badge.className = 'badge-test';
        badge.textContent = '시험: wind';
        el.appendChild(badge);
    }
}

// ─────────────────────────────────────────────
// 화면 그리기
// ─────────────────────────────────────────────

// 날씨 문자열 만들기
function getWeatherString(weather) {
    if (!weather) return '날씨 확인 전';
    return `${weather.maxTemp}°C · ${weather.windSpeed}m/s · ${weather.rainProbability}%`;
}

// 오늘 날씨 섹션 렌더링
function renderWeatherSummary() {
    const grid = document.getElementById('weatherSummary');
    grid.textContent = '';

    const regions = Object.keys(REGIONS);
    if (regions.every(region => !weatherData[region])) {
        const empty = document.createElement('div');
        empty.className = 'weather-empty';
        empty.textContent = '날씨를 받지 못했습니다. 새로고침을 눌러 주세요.';
        grid.appendChild(empty);
        return;
    }

    regions.forEach(region => {
        const card = document.createElement('div');
        card.className = 'weather-card';
        if (region === currentRegion) card.classList.add('is-current');

        const name = document.createElement('div');
        name.className = 'region-name';
        name.textContent = region;

        if (region === currentRegion) {
            const badge = document.createElement('span');
            badge.className = 'badge-current';
            badge.textContent = '현재 위치';
            name.appendChild(badge);
        }

        const info = document.createElement('div');
        info.className = 'weather-info';
        info.textContent = getWeatherString(weatherData[region]);

        card.appendChild(name);
        card.appendChild(info);
        grid.appendChild(card);
    });
}

// 판단 결과를 클래스명으로 변환 (공백 제거)
function getJudgmentClass(judgment) {
    return `judgment-${judgment.replace(/\s/g, '')}`;
}

// 테이블에 일정 목록 렌더링
function renderTasks(tasks) {
    const taskBody = document.getElementById('taskBody');
    taskBody.textContent = '';

    tasks.forEach(task => {
        const weather = weatherData[task.region];
        const judgment = judgeTask(task, weather);

        const row = document.createElement('tr');
        if (task.region === currentRegion) row.classList.add('is-current-region');

        [task.title, task.region, task.kind, task.owner, getWeatherString(weather)]
            .forEach(value => {
                const cell = document.createElement('td');
                cell.textContent = value;
                row.appendChild(cell);
            });

        const judgmentCell = document.createElement('td');
        judgmentCell.className = getJudgmentClass(judgment);
        judgmentCell.textContent = judgment;
        row.appendChild(judgmentCell);

        taskBody.appendChild(row);
    });
}

// 화면 전체 다시 그리기
function renderAll() {
    renderSource();
    renderUpdatedAt();
    renderWeatherSummary();
    renderTasks(loadTasks());
}

// ─────────────────────────────────────────────
// 저장 · 추가
// ─────────────────────────────────────────────

// LocalStorage에서 일정 불러오기
function loadTasks() {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
        try {
            return JSON.parse(stored);
        } catch (e) {
            console.error('일정 불러오기 실패:', e);
            return initialTasks;
        }
    }
    return initialTasks;
}

// LocalStorage에 일정 저장
function saveTasks(tasks) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
}

// 일정 추가
function addTask(title, region, kind, owner) {
    const tasks = loadTasks();
    tasks.push({ title, region, kind, owner });
    saveTasks(tasks);
    renderTasks(tasks);
}

// 오늘 날짜 표시 (YYYY-MM-DD)
function displayTodayDate() {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const date = String(today.getDate()).padStart(2, '0');

    const todayDateEl = document.getElementById('todayDate');
    if (todayDateEl) {
        todayDateEl.textContent = `${year}-${month}-${date}`;
    }
}

// ─────────────────────────────────────────────
// 날씨 새로고침
// ─────────────────────────────────────────────

async function refreshWeather() {
    const button = document.getElementById('refreshBtn');
    button.disabled = true;
    button.textContent = '받는 중…';

    try {
        const data = await fetchWeatherData();
        weatherData = applyTestParameters(data);
        lastUpdated = Date.now();
    } finally {
        button.disabled = false;
        button.textContent = '새로고침';
        renderAll();
    }
}

// ─────────────────────────────────────────────
// 초기 로드
// ─────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
    displayTodayDate();
    renderTasks(loadTasks());

    await detectCurrentRegion();
    await refreshWeather();

    // 'N분 전' 문구를 30초마다 다시 계산
    tickerTimer = setInterval(renderUpdatedAt, 30000);

    document.getElementById('refreshBtn')
        .addEventListener('click', refreshWeather);

    // 폼 제출 이벤트
    const form = document.getElementById('addTaskForm');
    form.addEventListener('submit', (e) => {
        e.preventDefault();

        const title = document.getElementById('taskTitle').value;
        const region = document.getElementById('taskRegion').value;
        const kind = document.getElementById('taskKind').value;
        const owner = document.getElementById('taskOwner').value;

        if (title && region && kind && owner) {
            addTask(title, region, kind, owner);
            form.reset();
        }
    });
});
