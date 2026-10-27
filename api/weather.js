// 지역별 기상청 동네예보 격자 좌표
const REGION_GRID = {
    세종: { nx: 66, ny: 103 },
    대전: { nx: 67, ny: 100 },
    태안: { nx: 51, ny: 109 },
    보령: { nx: 54, ny: 100 }
};

// 단기예보 발표 시각 (1일 8회)
const BASE_HOURS = [2, 5, 8, 11, 14, 17, 20, 23];

// 발표 후 자료가 올라올 때까지 두는 여유 (분)
const PUBLISH_DELAY_MIN = 45;

// 기준 시각을 못 찾으면 이전 발표 시각으로 재시도하는 횟수
const MAX_BASE_TRIES = 3;

const pad2 = n => String(n).padStart(2, '0');

// 한국 시각(KST) 기준 Date. getUTC* 로 읽으면 KST 값이 나온다.
function getKstDate(offsetMinutes = 0) {
    return new Date(Date.now() + (9 * 60 - offsetMinutes) * 60 * 1000);
}

function formatDate(date) {
    return `${date.getUTCFullYear()}${pad2(date.getUTCMonth() + 1)}${pad2(date.getUTCDate())}`;
}

// 최근 발표 시각부터 거슬러 올라가며 후보 만들기
function getBaseCandidates(count) {
    const kst = getKstDate(PUBLISH_DELAY_MIN);
    let cursor = new Date(Date.UTC(
        kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate(), kst.getUTCHours()
    ));

    const candidates = [];
    while (candidates.length < count) {
        const hour = cursor.getUTCHours();
        const slot = BASE_HOURS.filter(h => h <= hour).pop();

        if (slot === undefined) {
            // 오늘 02시 이전이면 어제 23시로 내려간다
            cursor = new Date(Date.UTC(
                cursor.getUTCFullYear(), cursor.getUTCMonth(), cursor.getUTCDate() - 1, 23
            ));
            continue;
        }

        candidates.push({ baseDate: formatDate(cursor), baseTime: `${pad2(slot)}00` });

        // 한 칸 이전 발표 시각으로
        cursor = new Date(Date.UTC(
            cursor.getUTCFullYear(), cursor.getUTCMonth(), cursor.getUTCDate(), slot - 1
        ));
    }

    return candidates;
}

// Encoding 키면 그대로, Decoding 키면 인코딩해서 쓴다
function normalizeServiceKey(key) {
    return key.includes('%') ? key : encodeURIComponent(key);
}

// 한 지역의 예보 항목 받기
async function fetchForecastItems(serviceKey, grid, base) {
    const url = 'https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getVilageFcst'
        + `?serviceKey=${serviceKey}`
        + '&pageNo=1&numOfRows=1000&dataType=JSON'
        + `&base_date=${base.baseDate}&base_time=${base.baseTime}`
        + `&nx=${grid.nx}&ny=${grid.ny}`;

    const response = await fetch(url);
    const text = await response.text();

    let data;
    try {
        data = JSON.parse(text);
    } catch (e) {
        // 인증키가 잘못되면 XML 로 에러가 돌아온다. 키가 섞여 나가지 않게 메시지만 뽑는다.
        const match = text.match(/<returnAuthMsg>([^<]*)<\/returnAuthMsg>/)
            || text.match(/<errMsg>([^<]*)<\/errMsg>/);
        throw new Error(match ? `기상청 오류: ${match[1]}` : '기상청 응답을 해석하지 못했습니다');
    }

    const header = data.response && data.response.header;
    if (!header) throw new Error('기상청 응답 형식이 예상과 다릅니다');
    if (header.resultCode !== '00') {
        throw new Error(`기상청 오류(${header.resultCode}): ${header.resultMsg}`);
    }

    const items = data.response.body
        && data.response.body.items
        && data.response.body.items.item;

    if (!Array.isArray(items)) throw new Error('예보 항목이 비어 있습니다');
    return items;
}

// 오늘 예보에서 최고 기온 · 최대 풍속 · 최대 강수확률 뽑기
function summarizeToday(items, today) {
    const picked = { TMP: [], WSD: [], POP: [] };

    items.forEach(item => {
        if (item.fcstDate !== today) return;
        if (!(item.category in picked)) return;

        const value = parseFloat(item.fcstValue);
        if (Number.isFinite(value)) picked[item.category].push(value);
    });

    if (!picked.TMP.length || !picked.WSD.length || !picked.POP.length) return null;

    return {
        maxTemp: Math.max(...picked.TMP),
        windSpeed: Math.max(...picked.WSD),
        rainProbability: Math.max(...picked.POP)
    };
}

export default async function handler(req, res) {
    const rawKey = process.env.data_api_key;

    if (!rawKey) {
        return res.status(500).json({ error: 'API key not configured' });
    }

    const serviceKey = normalizeServiceKey(rawKey.trim());
    const today = formatDate(getKstDate());
    const candidates = getBaseCandidates(MAX_BASE_TRIES);

    let lastError = null;

    // 최근 발표 시각부터 차례로 시도한다
    for (const base of candidates) {
        try {
            const weatherData = {};

            for (const [region, grid] of Object.entries(REGION_GRID)) {
                const items = await fetchForecastItems(serviceKey, grid, base);
                const summary = summarizeToday(items, today);

                if (!summary) throw new Error(`${region}: 오늘 예보가 없습니다`);
                weatherData[region] = summary;
            }

            res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
            return res.status(200).json(weatherData);
        } catch (error) {
            lastError = error;
            console.error(`기상청 조회 실패 (base ${base.baseDate} ${base.baseTime}):`, error.message);
        }
    }

    return res.status(500).json({
        error: lastError ? lastError.message : '날씨를 받지 못했습니다',
        triedBase: candidates.map(b => `${b.baseDate} ${b.baseTime}`)
    });
}
