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
