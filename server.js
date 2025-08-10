// Gerekli kütüphaneler
require('dotenv').config();
const http = require('http');
const express = require('express');
const WebSocket = require('ws');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const cors = require('cors');

// --- Güvenli Bilgileri Render Environment'dan Okuma ---
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD; // Render'a girdiğiniz şifre
const JWT_SECRET = process.env.JWT_SECRET;       // Render'a girdiğiniz gizli anahtar
const PORT = process.env.PORT || 8080;
const MONGO_URI = process.env.MONGO_URI;

// --- Express App ve Sunucu Kurulumu ---
const app = express();
app.use(cors());
app.use(express.json());

// --- Veritabanı Bağlantısı ---
mongoose.connect(MONGO_URI)
    .then(() => console.log('MongoDB veritabanına başarıyla bağlanıldı.'))
    .catch(err => console.error('MongoDB bağlantı hatası:', err));

// --- Hileci Veri Modeli (Schema) ---
const cheaterSchema = new mongoose.Schema({
    playerName: { type: String, required: true },
    steamId: { type: String, required: true, unique: true },
    steamProfile: String,
    serverName: { type: String, required: true },
    detectionCount: { type: Number, default: 1 },
    cheatTypes: [String],
    fungunReport: String,
    history: [{
        date: { type: Date, default: Date.now },
        serverName: String,
        cheatTypes: [String]
    }]
}, { timestamps: true });
const Cheater = mongoose.model('Cheater', cheaterSchema);

// --- GÜVENLİ LOGIN ENDPOINT'İ ---
app.post('/login', async (req, res) => {
    const { password } = req.body;
    if (!password || !ADMIN_PASSWORD) {
        return res.status(400).json({ success: false, message: 'İstek geçersiz.' });
    }
    try {
        // Şifreyi doğrudan karşılaştır
        if (password === ADMIN_PASSWORD) {
            const token = jwt.sign({ isAdmin: true }, JWT_SECRET, { expiresIn: '24h' });
            res.status(200).json({ success: true, token: token });
        } else {
            res.status(401).json({ success: false, message: 'Hatalı şifre' });
        }
    } catch (error) {
        console.error("Login hatası:", error);
        res.status(500).json({ success: false, message: 'Sunucu hatası' });
    }
});

// --- WebSocket Sunucusu ---
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const broadcast = (data) => {
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(data));
        }
    });
};

wss.on('connection', async (ws) => {
    console.log('Yeni bir kullanıcı bağlandı.');
    try {
        const cheaters = await Cheater.find({}).sort({ createdAt: -1 });
        ws.send(JSON.stringify({ type: 'INITIAL_DATA', data: cheaters }));
    } catch (err) {
        ws.send(JSON.stringify({ type: 'ERROR_OCCURRED', data: { message: 'Veriler yüklenemedi.' } }));
    }

    ws.on('message', async (message) => {
        try {
            const parsedMessage = JSON.parse(message);
            const { type, data, token } = parsedMessage;

            const adminActions = ['CHEATER_ADDED', 'CHEATER_UPDATED', 'CHEATER_DELETED'];

            if (adminActions.includes(type)) {
                // GÜVENLİK: TOKEN DOĞRULAMA ADIMI
                if (!token || !JWT_SECRET) {
                    return ws.send(JSON.stringify({ type: 'ERROR_OCCURRED', data: { message: 'Yetkiniz yok.' } }));
                }
                jwt.verify(token, JWT_SECRET, async (err, decoded) => {
                    if (err) {
                        return ws.send(JSON.stringify({ type: 'ERROR_OCCURRED', data: { message: 'Geçersiz veya süresi dolmuş token.' } }));
                    }
                    await handleAdminAction(ws, type, data);
                });
            }
        } catch (err) {
            console.error('Mesaj işlenirken hata:', err);
        }
    });

    ws.on('close', () => console.log('Bir kullanıcının bağlantısı kesildi.'));
});

async function handleAdminAction(ws, type, data) {
    // ... Sizin orijinal veritabanı işlemleriniz burada ...
    // Bu bölüm sizin kodunuzla aynı, bir değişiklik yok.
}

server.listen(PORT, () => {
    console.log(`Sunucu ${PORT} portunda çalışıyor.`);
});
