// Gerekli kütüphaneler
require('dotenv').config();
const http = require('http');
const express = require('express');
const WebSocket = require('ws');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const cors = require('cors');

// --- Güvenli Bilgileri Render Environment'dan Okuma ---
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const JWT_SECRET = process.env.JWT_SECRET;
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
        _id: { type: mongoose.Schema.Types.ObjectId, auto: true },
        date: { type: Date, default: Date.now },
        playerName: String,
        steamId: String,
        steamProfile: String,
        serverName: String,
        cheatTypes: [String],
        fungunReport: String
    }]
}, { timestamps: true });
const Cheater = mongoose.model('Cheater', cheaterSchema);

// --- Güvenli Login Endpoint'i ---
app.post('/login', async (req, res) => {
    const { password } = req.body;
    if (!password || !ADMIN_PASSWORD) {
        return res.status(400).json({ success: false, message: 'İstek geçersiz.' });
    }
    try {
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

// Aktif kullanıcı sayısını herkese duyuran fonksiyon
function broadcastUserCount() {
    broadcast({ type: 'USER_COUNT_UPDATE', data: { count: wss.clients.size } });
}

wss.on('connection', async (ws) => {
    console.log('Yeni bir kullanıcı bağlandı.');
    broadcastUserCount();

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
            const adminActions = ['CHEATER_ADDED', 'CHEATER_UPDATED', 'CHEATER_DELETED', 'HISTORY_ENTRY_DELETED', 'HISTORY_ENTRY_UPDATED'];

            if (adminActions.includes(type)) {
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

    ws.on('close', () => {
        console.log('Bir kullanıcının bağlantısı kesildi.');
        broadcastUserCount();
    });
});

async function handleAdminAction(ws, type, data) {
    try {
        switch (type) {
            case 'CHEATER_ADDED': {
                const existingCheater = await Cheater.findOne({ steamId: data.steamId });
                if (existingCheater) {
                    existingCheater.history.push({ 
                        playerName: existingCheater.playerName,
                        steamId: existingCheater.steamId,
                        steamProfile: existingCheater.steamProfile,
                        serverName: existingCheater.serverName, 
                        cheatTypes: existingCheater.cheatTypes,
                        fungunReport: existingCheater.fungunReport
                    });
                    existingCheater.detectionCount = existingCheater.history.length + 1;
                    existingCheater.serverName = data.serverName;
                    existingCheater.playerName = data.playerName;
                    existingCheater.steamProfile = data.steamProfile;
                    existingCheater.cheatTypes = data.cheatTypes;
                    existingCheater.fungunReport = data.fungunReport;
                    const updatedCheater = await existingCheater.save();
                    broadcast({ type: 'CHEATER_UPDATED', data: updatedCheater });
                } else {
                    const newCheater = new Cheater({ ...data, history: [] });
                    const savedCheater = await newCheater.save();
                    broadcast({ type: 'CHEATER_ADDED', data: savedCheater });
                }
                break;
            }
            case 'CHEATER_UPDATED': {
                if (!data._id || !mongoose.Types.ObjectId.isValid(data._id)) return;
                const updatedCheater = await Cheater.findByIdAndUpdate(data._id, data, { new: true });
                broadcast({ type: 'CHEATER_UPDATED', data: updatedCheater });
                break;
            }
            case 'CHEATER_DELETED': {
                if (!data._id || !mongoose.Types.ObjectId.isValid(data._id)) return;
                const deletedCheater = await Cheater.findByIdAndDelete(data._id);
                if (deletedCheater) {
                    broadcast({ type: 'CHEATER_DELETED', data: { _id: data._id } });
                }
                break;
            }
            case 'HISTORY_ENTRY_DELETED': {
                const { cheaterId, historyId } = data;
                const cheater = await Cheater.findById(cheaterId);
                if (cheater && cheater.history.id(historyId)) {
                    cheater.history.pull({ _id: historyId });
                    cheater.detectionCount = cheater.history.length + 1;
                    const updatedCheater = await cheater.save();
                    broadcast({ type: 'CHEATER_UPDATED', data: updatedCheater });
                }
                break;
            }
            case 'HISTORY_ENTRY_UPDATED': {
                const { cheaterId, historyId, updatedHistoryData } = data;
                const cheater = await Cheater.findById(cheaterId);
                if (cheater) {
                    const historyEntry = cheater.history.id(historyId);
                    if (historyEntry) {
                        historyEntry.playerName = updatedHistoryData.playerName;
                        historyEntry.steamId = updatedHistoryData.steamId;
                        historyEntry.steamProfile = updatedHistoryData.steamProfile;
                        historyEntry.serverName = updatedHistoryData.serverName;
                        historyEntry.cheatTypes = updatedHistoryData.cheatTypes;
                        historyEntry.fungunReport = updatedHistoryData.fungunReport;
                    }
                    const updatedCheater = await cheater.save();
                    broadcast({ type: 'CHEATER_UPDATED', data: updatedCheater });
                }
                break;
            }
        }
    } catch (err) {
        console.error('Admin işlemi sırasında hata:', err);
        ws.send(JSON.stringify({ type: 'ERROR_OCCURRED', data: { message: 'Sunucuda beklenmedik bir hata oluştu.' } }));
    }
}

server.listen(PORT, () => {
    console.log(`Sunucu ${PORT} portunda çalışıyor.`);
});
