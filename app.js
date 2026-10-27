// 지역 정보 (기상청 동네예보 격자 좌표 + 위경도)
const REGIONS = {
    세종: { nx: 66, ny: 103, lat: 36.4800, lon: 127.2890 },
    대전: { nx: 67, ny: 100, lat: 36.3504, lon: 127.3845 },
    태안: { nx: 51, ny: 109, lat: 36.7456, lon: 126.2978 },
    보령: { nx: 54, ny: 100, lat: 36.3334, lon: 126.6128 }
};

const TASKS_URL = 'data/tasks.json';
const ADDED_TASKS_KEY = 'addedTasks';   // 화면에서 추가한 일정만 저장
const LEGACY_TASKS_KEY = 'tasks';       // 예전 버전이 쓰던 칸
const REGION_PREF_KEY = 'regionPref';
const DEFAULT_REGION = '세종';
const AUTO_REFRESH_MS = 5 * 60 * 1000;   // 5분마다 자동 갱신
const TICKER_MS = 30 * 1000;             // 'N분 전' 문구 다시 계산

// 날씨 출처 두 곳. 판단은 kma 를 먼저 쓰고, 없으면 openMeteo 로 대체한다.
const SOURCE_ORDER = ['kma', 'openMeteo'];
const SOURCE_LABELS = {
    kma: '기상청 단기예보',
    openMeteo: 'Open-Meteo'
};

// 출처별 상태
const sources = {
    kma: { data: {}, lastUpdated: null, isLoading: false, error: null },
    openMeteo: { data: {}, lastUpdated: null, isLoading: false, error: null }
};

// 화면 상태
let currentRegion = null;
let isAutoRegion = true;
let tickerTimer = null;
let autoRefreshTimer = null;
let baseTasks = [];           // data/tasks.json 에서 읽은 일정
let baseTasksLoaded = false;  // 파일을 읽었는지

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
    isAutoRegion = true;

    try {
        const coords = await getCurrentPosition();
        const nearest = findNearestRegion(coords.latitude, coords.longitude);
        currentRegion = nearest.region;
        statusEl.textContent = `가장 가까운 지역 · 약 ${Math.round(nearest.distance)}km`;
    } catch (e) {
        currentRegion = DEFAULT_REGION;
        statusEl.textContent = `위치를 확인할 수 없어 ${DEFAULT_REGION} 기준`;
    }
}

// 드롭다운에서 고른 지역으로 기준 바꾸기
async function applyRegionChoice(choice) {
    localStorage.setItem(REGION_PREF_KEY, choice);

    if (choice === 'auto') {
        await detectCurrentRegion();
    } else {
        isAutoRegion = false;
        currentRegion = choice;
        document.getElementById('locationStatus').textContent = '직접 고른 지역';
    }
}

// ─────────────────────────────────────────────
// 날씨 받기
// ─────────────────────────────────────────────

// 기상청 단기예보 (Vercel 서버리스 함수를 거친다)
async function fetchKmaWeather() {
    const response = await fetch('/api/weather');
    const data = await response.json().catch(() => null);

    if (!response.ok || !data) {
        throw new Error((data && data.error) || '기상청 자료를 받지 못했습니다');
    }
    if (data.error) throw new Error(data.error);

    return data;
}

// Open-Meteo 예보 (브라우저에서 바로 받는다)
async function fetchOpenMeteoWeather() {
    const result = {};

    for (const [region, info] of Object.entries(REGIONS)) {
        // wind_speed_unit=ms : 기본값이 km/h 라 기상청과 단위를 맞춘다
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${info.lat}&longitude=${info.lon}&daily=temperature_2m_max,wind_speed_10m_max,precipitation_probability_max&wind_speed_unit=ms&timezone=Asia/Seoul`;

        const response = await fetch(url);
        if (!response.ok) throw new Error(`${region} 자료를 받지 못했습니다`);

        const daily = (await response.json()).daily;
        result[region] = {
            maxTemp: daily.temperature_2m_max[0],
            windSpeed: daily.wind_speed_10m_max[0],
            rainProbability: daily.precipitation_probability_max[0]
        };
    }

    return result;
}

const SOURCE_FETCHERS = {
    kma: fetchKmaWeather,
    openMeteo: fetchOpenMeteoWeather
};

// 판단에 쓸 출처 고르기 (기상청 우선, 없으면 Open-Meteo)
function getJudgmentSourceKey() {
    return SOURCE_ORDER.find(key => Object.keys(sources[key].data).length > 0) || null;
}

// 판단에 쓸 날씨 묶음
function getJudgmentWeather() {
    const key = getJudgmentSourceKey();
    return key ? sources[key].data : {};
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

// 패널마다 갱신 시각 다시 그리기
function renderUpdatedAt() {
    SOURCE_ORDER.forEach(key => {
        const el = document.getElementById(`updated-${key}`);
        const state = sources[key];

        if (!state.lastUpdated) {
            el.textContent = '';
            el.removeAttribute('title');
            return;
        }
        el.textContent = `${formatRelativeTime(state.lastUpdated)} 받음`;
        el.title = `${formatClockTime(state.lastUpdated)} 기준`;
    });
}

// 섹션 머리말 (측정 항목 안내 + 시험 배지)
function renderSource() {
    const el = document.getElementById('weatherSource');
    el.textContent = '';

    const text = document.createElement('span');
    text.textContent = '최고 기온 · 최대 풍속 · 강수확률';
    el.appendChild(text);

    if (isWindTest()) {
        const badge = document.createElement('span');
        badge.className = 'badge-test';
        badge.textContent = '시험: wind';
        el.appendChild(badge);
    }
}

// 일정표의 판단이 어느 출처로 계산됐는지 표시
function renderJudgmentSource() {
    const el = document.getElementById('judgmentSource');
    const key = getJudgmentSourceKey();

    el.textContent = key
        ? `판단 기준: ${SOURCE_LABELS[key]}`
        : '판단 기준: 날씨를 받지 못해 판단할 수 없습니다';
}

// ─────────────────────────────────────────────
// 화면 그리기
// ─────────────────────────────────────────────

// 날씨 문자열 만들기 (문구는 logic.js 와 같은 것을 쓴다)
function getWeatherString(weather) {
    return formatWeatherCell(weather);
}

// 수치 한 칸 만들기
function createStat(label, value) {
    const stat = document.createElement('div');
    stat.className = 'stat';

    const labelEl = document.createElement('div');
    labelEl.className = 'stat-label';
    labelEl.textContent = label;

    const valueEl = document.createElement('div');
    valueEl.className = 'stat-value';
    valueEl.textContent = value;

    stat.appendChild(labelEl);
    stat.appendChild(valueEl);
    return stat;
}

// 패널 한 개 그리기 (현재 위치 지역만)
function renderPanel(key) {
    const body = document.getElementById(`body-${key}`);
    const state = sources[key];
    body.textContent = '';

    if (state.isLoading) {
        const skeleton = document.createElement('div');
        skeleton.className = 'weather-skeleton';
        skeleton.textContent = '날씨를 받는 중…';
        body.appendChild(skeleton);
        return;
    }

    const weather = state.data[currentRegion];
    if (!weather) {
        const empty = document.createElement('div');
        empty.className = 'weather-empty';
        empty.textContent = state.error
            ? `받지 못했습니다: ${state.error}`
            : '날씨를 받지 못했습니다. 새로고침을 눌러 주세요.';
        body.appendChild(empty);
        return;
    }

    const name = document.createElement('div');
    name.className = 'region-name';
    name.textContent = currentRegion;

    const badge = document.createElement('span');
    badge.className = 'badge-current';
    badge.textContent = isAutoRegion ? '현재 위치' : '직접 선택';
    name.appendChild(badge);

    const stats = document.createElement('div');
    stats.className = 'stat-row';
    stats.appendChild(createStat('최고 기온', `${weather.maxTemp}°C`));
    stats.appendChild(createStat('최대 풍속', `${weather.windSpeed}m/s`));
    stats.appendChild(createStat('강수확률', `${weather.rainProbability}%`));

    body.appendChild(name);
    body.appendChild(stats);
}

// 두 패널 모두 그리기
function renderWeatherPanels() {
    SOURCE_ORDER.forEach(renderPanel);
}

// 판단 결과를 클래스명으로 변환 (공백 제거)
function getJudgmentClass(judgment) {
    return `judgment-${judgment.replace(/\s/g, '')}`;
}

// 테이블에 일정 목록 렌더링
function renderTasks(tasks) {
    const taskBody = document.getElementById('taskBody');
    const judgmentWeather = getJudgmentWeather();
    taskBody.textContent = '';

    tasks.forEach(task => {
        const weather = judgmentWeather[task.region];
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
    renderWeatherPanels();
    renderDataNotice();
    renderJudgmentSource();
    renderTasks(getAllTasks());
    updateSaveButtonState();
}

// ─────────────────────────────────────────────
// 저장 · 추가
// ─────────────────────────────────────────────

// data/tasks.json 에서 기본 일정 읽기
async function loadBaseTasks() {
    try {
        const response = await fetch(TASKS_URL);
        if (!response.ok) throw new Error(`${TASKS_URL} 응답 오류`);

        const data = await response.json();
        if (!Array.isArray(data)) throw new Error(`${TASKS_URL} 형식 오류`);

        baseTasksLoaded = true;
        return data;
    } catch (e) {
        console.error('일정 파일을 읽지 못했습니다:', e);
        baseTasksLoaded = false;
        return [];
    }
}

// 화면에서 추가한 일정 불러오기
function loadAddedTasks() {
    const stored = localStorage.getItem(ADDED_TASKS_KEY);
    if (!stored) return [];

    try {
        const data = JSON.parse(stored);
        return Array.isArray(data) ? data : [];
    } catch (e) {
        console.error('추가한 일정 불러오기 실패:', e);
        return [];
    }
}

// 화면에서 추가한 일정 저장
function saveAddedTasks(tasks) {
    localStorage.setItem(ADDED_TASKS_KEY, JSON.stringify(tasks));
}

// 일정 하나를 비교용 글자로 만들기
function getTaskKey(task) {
    return [task.title, task.region, task.kind, task.owner].join('|');
}

// 예전 버전이 저장한 목록에서 추가분만 옮겨오기 (한 번만)
function migrateLegacyTasks() {
    const legacy = localStorage.getItem(LEGACY_TASKS_KEY);
    if (!legacy || localStorage.getItem(ADDED_TASKS_KEY)) return;

    try {
        const all = JSON.parse(legacy);
        if (!Array.isArray(all)) return;

        const baseKeys = new Set(baseTasks.map(getTaskKey));
        saveAddedTasks(all.filter(task => !baseKeys.has(getTaskKey(task))));
    } catch (e) {
        console.warn('예전 일정 옮기기 실패:', e);
    }
}

// JSON 일정 + 추가한 일정
function getAllTasks() {
    return baseTasks.concat(loadAddedTasks());
}

// 일정 추가 (추가한 것만 브라우저에 저장)
function addTask(title, region, kind, owner) {
    const added = loadAddedTasks();
    added.push({ title, region, kind, owner });
    saveAddedTasks(added);
    renderTasks(getAllTasks());
}

// 파일을 못 읽었을 때 안내 문구
function renderDataNotice() {
    const el = document.getElementById('dataNotice');
    if (baseTasksLoaded) {
        el.hidden = true;
        el.textContent = '';
        return;
    }
    el.hidden = false;
    el.textContent = '일정 파일을 읽지 못했습니다. 배포 주소로 열어 주세요.';
}

// 오늘 날짜 글자 만들기 (YYYY-MM-DD)
function getTodayString() {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const date = String(today.getDate()).padStart(2, '0');
    return `${year}-${month}-${date}`;
}

// 오늘 날짜 표시
function displayTodayDate() {
    const todayDateEl = document.getElementById('todayDate');
    if (todayDateEl) {
        todayDateEl.textContent = getTodayString();
    }
}

// 날씨를 받기 전에는 md 저장 버튼을 잠가 둔다
function updateSaveButtonState() {
    const button = document.getElementById('saveMdBtn');
    if (!button) return;

    const anyLoading = SOURCE_ORDER.some(key => sources[key].isLoading);
    const ready = !anyLoading && getJudgmentSourceKey() !== null;
    button.disabled = !ready;
    button.title = ready ? '' : '날씨를 받은 뒤에 저장할 수 있습니다';
}

// 오늘 판단을 md 파일로 내려받기
function downloadJudgmentMarkdown() {
    const dateString = getTodayString();
    const sourceKey = getJudgmentSourceKey();
    const markdown = buildJudgmentMarkdown(
        getAllTasks(),
        getJudgmentWeather(),
        dateString,
        sourceKey ? SOURCE_LABELS[sourceKey] : ''
    );

    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = url;
    link.download = `현장일정_판단_${dateString}.md`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    URL.revokeObjectURL(url);
}

// ─────────────────────────────────────────────
// 날씨 새로고침
// ─────────────────────────────────────────────

// 출처 한 곳만 새로 받기
async function refreshSource(key) {
    const state = sources[key];
    if (state.isLoading) return;

    const button = document.getElementById(`refresh-${key}`);
    state.isLoading = true;
    button.disabled = true;
    button.textContent = '받는 중…';
    updateSaveButtonState();
    renderPanel(key);

    try {
        state.data = applyTestParameters(await SOURCE_FETCHERS[key]());
        state.lastUpdated = Date.now();
        state.error = null;
    } catch (e) {
        console.error(`${SOURCE_LABELS[key]} 오류:`, e);
        state.data = {};
        state.error = e.message;
    } finally {
        state.isLoading = false;
        button.disabled = false;
        button.textContent = '새로고침';
        renderAll();
    }
}

// 두 출처를 같이 받기
function refreshAllSources() {
    return Promise.all(SOURCE_ORDER.map(refreshSource));
}

// 5분마다 자동 갱신
function startAutoRefresh() {
    if (autoRefreshTimer) clearInterval(autoRefreshTimer);
    autoRefreshTimer = setInterval(refreshAllSources, AUTO_REFRESH_MS);
}

// 다른 탭에 갔다 돌아왔을 때, 받은 지 5분이 넘었으면 다시 받기
function handleVisibilityChange() {
    if (document.visibilityState !== 'visible') return;

    const oldest = Math.min(...SOURCE_ORDER.map(key => sources[key].lastUpdated || 0));
    if (Date.now() - oldest >= AUTO_REFRESH_MS) {
        refreshAllSources();
    } else {
        renderUpdatedAt();
    }
}

// ─────────────────────────────────────────────
// 초기 로드
// ─────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
    displayTodayDate();

    const select = document.getElementById('regionSelect');

    // 버튼부터 먼저 연결한다. 날씨를 받는 동안에도 눌리게 하려는 것이 아니라,
    // 눌렀을 때 아무 반응이 없는 상태를 만들지 않기 위해서다.
    SOURCE_ORDER.forEach(key => {
        document.getElementById(`refresh-${key}`)
            .addEventListener('click', () => refreshSource(key));
    });

    document.getElementById('saveMdBtn')
        .addEventListener('click', downloadJudgmentMarkdown);

    select.addEventListener('change', async () => {
        await applyRegionChoice(select.value);
        renderAll();
    });

    updateSaveButtonState();

    // 일정은 data/tasks.json 을 먼저 읽고, 추가한 일정을 뒤에 붙인다
    baseTasks = await loadBaseTasks();
    migrateLegacyTasks();
    renderDataNotice();
    renderTasks(getAllTasks());

    // 지난번에 고른 기준 지역 복원
    const savedChoice = localStorage.getItem(REGION_PREF_KEY);
    if (savedChoice && (savedChoice === 'auto' || REGIONS[savedChoice])) {
        select.value = savedChoice;
    }

    await applyRegionChoice(select.value);
    renderSource();
    await refreshAllSources();

    // 'N분 전' 문구를 30초마다 다시 계산
    tickerTimer = setInterval(renderUpdatedAt, TICKER_MS);
    startAutoRefresh();
    document.addEventListener('visibilitychange', handleVisibilityChange);

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
