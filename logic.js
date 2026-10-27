// 판단 기준 한 줄 (저장하는 md 맨 아래에 넣는다)
const JUDGMENT_CRITERIA = '판단 기준: 실내는 영향 없음 · 고소이고 최대 풍속 10m/s 이상은 중지 검토 · 최고 기온 33℃ 이상은 폭염 휴식 · 강수확률 60% 이상은 우천 주의 · 그 밖은 진행';

// 날씨 한 칸 문구 만들기
function formatWeatherCell(weather) {
    if (!weather) return '날씨 확인 전';
    return `${weather.maxTemp}°C · ${weather.windSpeed}m/s · ${weather.rainProbability}%`;
}

// 표 칸에 들어갈 글자 다듬기 (| 가 표를 깨지 않게)
function escapeTableCell(text) {
    return String(text).replace(/\|/g, '\\|');
}

// 오늘 판단을 마크다운 문서로 만들기
function buildJudgmentMarkdown(tasks, weatherData, dateString) {
    const lines = [
        `# 현장 일정 판단 (${dateString})`,
        '',
        '| 일정 | 지역 | 구분 | 담당 | 날씨 | 판단 |',
        '|---|---|---|---|---|---|'
    ];

    tasks.forEach(task => {
        const weather = weatherData[task.region];
        const cells = [
            task.title,
            task.region,
            task.kind,
            task.owner,
            formatWeatherCell(weather),
            judgeTask(task, weather)
        ];
        lines.push(`| ${cells.map(escapeTableCell).join(' | ')} |`);
    });

    lines.push('', JUDGMENT_CRITERIA, '');
    return lines.join('\n');
}

// 판단 규칙 (날씨 판단)
function judgeTask(task, weather) {
    // 현재는 날씨 데이터 없음 (F-04에서 추가)
    if (!weather) {
        return '날씨 확인 전';
    }

    // R-01: 실내 일정은 날씨와 관계없이 '영향 없음'
    if (task.kind === '실내') {
        return '영향 없음';
    }

    // R-02: 고소 일정이고 최대 풍속 10 m/s 이상이면 '중지 검토'
    if (task.kind === '고소' && weather.windSpeed >= 10) {
        return '중지 검토';
    }

    // R-03: 최고 기온 33℃ 이상이면 '폭염 휴식'
    if (weather.maxTemp >= 33) {
        return '폭염 휴식';
    }

    // R-04: 강수확률 60% 이상이면 '우천 주의'
    if (weather.rainProbability >= 60) {
        return '우천 주의';
    }

    // R-05: 위 규칙에 하나도 안 걸리면 '진행'
    return '진행';
}
