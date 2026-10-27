// 지역별 격자 좌표 (기상단기예보 API용)
const regionCoordinates = {
    세종: { nx: 60, ny: 127 },
    대전: { nx: 68, ny: 100 },
    태안: { nx: 52, ny: 38 },
    보령: { nx: 56, ny: 79 }
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

// Vercel 서버리스 함수에서 날씨 데이터 받기
async function fetchWeatherData() {
    try {
        // 프로덕션: /api/weather 엔드포인트 호출
        const response = await fetch('/api/weather');
        if (response.ok) {
            return await response.json();
        } else {
            throw new Error('API response error');
        }
    } catch (e) {
        console.warn('서버 날씨 API 오류, Open-Meteo로 폴백:', e);
        // 폴백: Open-Meteo API 사용
        return fetchWeatherDataOpenMeteo();
    }
}

// Open-Meteo API (폴백용)
async function fetchWeatherDataOpenMeteo() {
    const weatherData = {};

    // Open-Meteo용 좌표 설정
    const openMeteoCoords = {
        세종: { lat: 36.48, lon: 127.29 },
        대전: { lat: 36.32, lon: 127.43 },
        태안: { lat: 36.95, lon: 126.37 },
        보령: { lat: 36.27, lon: 126.57 }
    };

    try {
        for (const [region, coords] of Object.entries(openMeteoCoords)) {
            const url = `https://api.open-meteo.com/v1/forecast?latitude=${coords.lat}&longitude=${coords.lon}&daily=temperature_2m_max,wind_speed_10m_max,precipitation_probability_max&timezone=Asia/Seoul`;

            const response = await fetch(url);
            if (!response.ok) throw new Error(`API error for ${region}`);

            const data = await response.json();
            const daily = data.daily;

            weatherData[region] = {
                maxTemp: daily.temperature_2m_max[0],
                windSpeed: daily.wind_speed_10m_max[0],
                rainProbability: daily.precipitation_probability_max[0]
            };
        }
    } catch (e) {
        console.error('Open-Meteo API 오류:', e);
    }

    return weatherData;
}

// ?test=wind 파라미터 처리
function applyTestParameters(weatherData) {
    const params = new URLSearchParams(window.location.search);
    const testWind = params.get('test');

    if (testWind === 'wind') {
        for (const region in weatherData) {
            weatherData[region].windSpeed = 12;
        }
    }

    return weatherData;
}

// 날씨 문자열 만들기
function getWeatherString(weather) {
    if (!weather) return '날씨 확인 전';
    return `${weather.maxTemp}°C, ${weather.windSpeed}m/s, ${weather.rainProbability}%`;
}

// 오늘 날씨 섹션 렌더링
function renderWeatherSummary(weatherData) {
    const weatherSummary = document.getElementById('weatherSummary');
    weatherSummary.innerHTML = '';

    for (const [region, weather] of Object.entries(weatherData)) {
        const card = document.createElement('div');
        card.className = 'weather-card';
        card.innerHTML = `
            <div class="region-name">${region}</div>
            <div class="weather-info">${getWeatherString(weather)}</div>
        `;
        weatherSummary.appendChild(card);
    }
}

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

// 판단 결과를 클래스명으로 변환
function getJudgmentClass(judgment) {
    return `judgment-${judgment}`;
}

// 테이블에 일정 목록 렌더링
function renderTasks(tasks, weatherData = {}) {
    const taskBody = document.getElementById('taskBody');
    taskBody.innerHTML = '';

    tasks.forEach(task => {
        const weather = weatherData[task.region];
        const judgment = judgeTask(task, weather);
        const weatherString = getWeatherString(weather);
        const judgmentClass = getJudgmentClass(judgment);

        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${task.title}</td>
            <td>${task.region}</td>
            <td>${task.kind}</td>
            <td>${task.owner}</td>
            <td>${weatherString}</td>
            <td class="${judgmentClass}">${judgment}</td>
        `;
        taskBody.appendChild(row);
    });
}

// 일정 추가
function addTask(title, region, kind, owner, weatherData = {}) {
    const tasks = loadTasks();
    tasks.push({ title, region, kind, owner });
    saveTasks(tasks);
    renderTasks(tasks, weatherData);
}

// 오늘 날짜 표시 (YYYY-MM-DD)
function displayTodayDate() {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const date = String(today.getDate()).padStart(2, '0');
    const dateString = `${year}-${month}-${date}`;

    const todayDateEl = document.getElementById('todayDate');
    if (todayDateEl) {
        todayDateEl.textContent = dateString;
    }
}

// 초기 로드
document.addEventListener('DOMContentLoaded', async () => {
    displayTodayDate();
    const tasks = loadTasks();

    // API로 날씨 데이터 받기
    let weatherData = await fetchWeatherData();
    weatherData = applyTestParameters(weatherData);

    renderWeatherSummary(weatherData);
    renderTasks(tasks, weatherData);

    // 폼 제출 이벤트
    const form = document.getElementById('addTaskForm');
    form.addEventListener('submit', (e) => {
        e.preventDefault();

        const title = document.getElementById('taskTitle').value;
        const region = document.getElementById('taskRegion').value;
        const kind = document.getElementById('taskKind').value;
        const owner = document.getElementById('taskOwner').value;

        if (title && region && kind && owner) {
            addTask(title, region, kind, owner, weatherData);
            form.reset();
        }
    });
});
