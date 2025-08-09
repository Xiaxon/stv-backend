// server.js - VERİTABANI DESTEKLİ KALICI SÜRÜM

require('dotenv').config();
const WebSocket = require('ws');
const mongoose = require('mongoose');

// --- Veritabanı Bağlantısı ---
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('MongoDB veritabanına başarıyla bağlanıldı.'))
    .catch(err => console.error('MongoDB bağlantı hatası:', err));

// --- Hileci Veri Modeli (Schema) ---
const cheaterSchema = new mongoose.Schema({
    playerName: { type: String, required: true },
    steamId: { type: String, required: true },
    steamProfile: String,
    serverName: { type: String, required: true },
    detectionCount: { type: Number, default: 1 },
    cheatTypes: [String],
    fungunReport: String,
});
const Cheater = mongoose.model('Cheater', cheaterSchema);

// --- WebSocket Sunucusu ---
const port = process.env.PORT || 8080;
const wss = new WebSocket.Server({ port });
console.log(`Sunucu ${port} portunda çalışıyor.`);

// --- Yayın Fonksiyonu ---
const broadcast = (data) => {
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(data));
        }
    });
};

// --- Ana WebSocket Mantığı ---
wss.on('connection', async ws => {
    console.log('Yeni kullanıcı bağlandı.');

    try {
        const cheaters = await Cheater.find({});
        ws.send(JSON.stringify({ type: 'INITIAL_DATA', data: cheaters }));
    } catch (err) {
        console.error('İlk veri gönderilirken hata:', err);
    }

    ws.on('message', async message => {
        const parsedMessage = JSON.parse(message);
        const { type, data } = parsedMessage;

        try {
            if (type === 'CHEATER_ADDED') {
                const newCheater = new Cheater(data);
                const savedCheater = await newCheater.save();
                console.log('Yeni hileci veritabanına eklendi:', savedCheater.playerName);
                broadcast({ type: 'CHEATER_ADDED', data: savedCheater });
            }
        } catch (err) {
            console.error('Mesaj işlenirken hata:', err);
        }
    });

    ws.on('close', () => {
        console.log('Bir kullanıcının bağlantısı kesildi.');
    });
});
