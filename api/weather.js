export default async function handler(req, res) {
    const apiKey = process.env.data_api_key;

    if (!apiKey) {
        return res.status(500).json({ error: 'API key not configured' });
    }

    try {
        // 기준 날짜·시간 설정
        const now = new Date();
        const baseDate = now.toISOString().slice(0, 10).replace(/-/g, '');
        const hour = Math.floor(now.getHours() / 3) * 3;
        const baseTime = `${String(hour).padStart(2, '0')}00`;

        // 지역별 기상청 동네예보 격자 좌표
        const regionCoordinates = {
            세종: { nx: 66, ny: 103 },
            대전: { nx: 67, ny: 100 },
            태안: { nx: 51, ny: 109 },
            보령: { nx: 54, ny: 100 }
        };

        const weatherData = {};

        for (const [region, coords] of Object.entries(regionCoordinates)) {
            const url = `https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getVilageFcst?serviceKey=${apiKey}&pageNo=1&numOfRows=60&dataType=JSON&base_date=${baseDate}&base_time=${baseTime}&nx=${coords.nx}&ny=${coords.ny}`;

            const response = await fetch(url);
            if (!response.ok) throw new Error(`API error for ${region}`);

            const data = await response.json();
            const items = data.response.body.items.item;

            // 카테고리별로 데이터 분류
            const tempValues = [];
            const windValues = [];
            const rainValues = [];

            items.forEach(item => {
                if (item.category === 'TMP') tempValues.push(parseFloat(item.fcstValue));
                if (item.category === 'WSD') windValues.push(parseFloat(item.fcstValue));
                if (item.category === 'POP') rainValues.push(parseFloat(item.fcstValue));
            });

            weatherData[region] = {
                maxTemp: Math.max(...tempValues),
                windSpeed: Math.max(...windValues),
                rainProbability: Math.max(...rainValues)
            };
        }

        res.status(200).json(weatherData);
    } catch (error) {
        console.error('Weather API error:', error);
        res.status(500).json({ error: error.message });
    }
}
