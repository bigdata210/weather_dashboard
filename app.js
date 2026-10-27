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

// 테이블에 일정 목록 렌더링
function renderTasks(tasks) {
    const taskBody = document.getElementById('taskBody');
    taskBody.innerHTML = '';

    tasks.forEach(task => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${task.title}</td>
            <td>${task.region}</td>
            <td>${task.kind}</td>
            <td>${task.owner}</td>
        `;
        taskBody.appendChild(row);
    });
}

// 일정 추가
function addTask(title, region, kind, owner) {
    const tasks = loadTasks();
    tasks.push({ title, region, kind, owner });
    saveTasks(tasks);
    renderTasks(tasks);
}

// 초기 로드
document.addEventListener('DOMContentLoaded', () => {
    const tasks = loadTasks();
    renderTasks(tasks);

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
