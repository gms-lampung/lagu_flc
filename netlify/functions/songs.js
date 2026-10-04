const axios = require('axios');
const SEED = require('../../seed/songs.json');

// ponytail: Netlify request ~6MB, Upstash value 100MB — lirik teks jauh di bawah itu.
// Upgrade path: Netlify Blobs bila butuh versi per lagu / riwayat.

function json(data, status = 200) {
    return {
        statusCode: status,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    };
}

function upstash() {
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (!url || !token) throw new Error('UPSTASH_REDIS_REST_URL/TOKEN not set');
    return axios.create({
        baseURL: url,
        headers: { Authorization: `Bearer ${token}` },
    });
}

async function redisGet(key) {
    const res = await upstash().get(`/get/${encodeURIComponent(key)}`);
    const val = res.data?.result;
    return val ? JSON.parse(val) : null;
}
async function redisSet(key, value) {
    await upstash().post(`/set/${encodeURIComponent(key)}`, JSON.stringify(value));
}
async function redisDel(key) {
    await upstash().post(`/del/${encodeURIComponent(key)}`);
}

function newId() {
    return Math.random().toString(36).substring(2, 14);
}

function cleanSong(body) {
    const title = (body.title || '').trim();
    const lyrics = (body.lyrics || '').trim();
    if (!title) return { error: 'Judul lagu wajib diisi' };
    if (!lyrics) return { error: 'Lirik lagu wajib diisi' };
    return { title, lyrics };
}

async function getOrSeedIndex() {
    let index = await redisGet('songs');
    if (index && index.length) return index;
    index = SEED.map((s) => ({
        id: newId(),
        title: s.title,
        lyrics: s.lyrics,
        created: new Date().toISOString(),
    }));
    await redisSet('songs', index);
    for (const song of index) await redisSet(`song_${song.id}`, song);
    return index;
}

exports.handler = async (event) => {
    try {
        const action = event.queryStringParameters?.action;

        if (action === 'list') {
            const index = await getOrSeedIndex();
            return json({ ok: true, items: index });
        }

        if (action === 'get') {
            const id = event.queryStringParameters?.id;
            if (!id) return json({ ok: false, error: 'Missing ID' }, 400);
            const song = await redisGet(`song_${id}`);
            if (!song) return json({ ok: false, error: 'Lagu tidak ditemukan' }, 404);
            return json({ ok: true, item: song });
        }

        if (action === 'add') {
            const body = JSON.parse(event.body || '{}');
            const v = cleanSong(body);
            if (v.error) return json({ ok: false, error: v.error }, 400);
            const song = { id: newId(), title: v.title, lyrics: v.lyrics, created: new Date().toISOString() };
            const index = await getOrSeedIndex();
            index.unshift(song);
            await redisSet('songs', index);
            await redisSet(`song_${song.id}`, song);
            return json({ ok: true, item: song });
        }

        if (action === 'update') {
            const body = JSON.parse(event.body || '{}');
            const id = event.queryStringParameters?.id || body.id;
            if (!id) return json({ ok: false, error: 'Missing ID' }, 400);
            const v = cleanSong(body);
            if (v.error) return json({ ok: false, error: v.error }, 400);
            const index = await getOrSeedIndex();
            const idx = index.findIndex((s) => s.id === id);
            if (idx === -1) return json({ ok: false, error: 'Lagu tidak ditemukan' }, 404);
            const prev = index[idx];
            const song = { ...prev, title: v.title, lyrics: v.lyrics };
            index[idx] = song;
            await redisSet('songs', index);
            await redisSet(`song_${song.id}`, song);
            return json({ ok: true, item: song });
        }

        if (action === 'delete') {
            const id = event.queryStringParameters?.id;
            if (!id) return json({ ok: false, error: 'Missing ID' }, 400);
            const index = await getOrSeedIndex();
            const idx = index.findIndex((s) => s.id === id);
            if (idx === -1) return json({ ok: false, error: 'Lagu tidak ditemukan' }, 404);
            index.splice(idx, 1);
            await redisSet('songs', index);
            await redisDel(`song_${id}`);
            return json({ ok: true });
        }

        return json({ ok: false, error: 'Invalid action: ' + action }, 404);
    } catch (err) {
        console.error(err);
        return json({ ok: false, error: err.message }, 500);
    }
};
