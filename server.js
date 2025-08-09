// server.js - VERİTABANI DESTEKLİ KALICI SÜRÜM

require('dotenv').config(); // .env dosyasını kullanmak için
const WebSocket = require('ws');
const mongoose = require('mongoose');

// --- 1. Veritabanı Bağlantısı ---
// .env dosyasındaki MONGO_URI değişkenini kullanarak veritabanına bağlanır.
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('MongoDB veritabanına başarıyla bağlanıldı.'))
    .catch(err => console.error('MongoDB bağlantı hatası:', err));

// --- 2. Hileci Veri Modeli (Schema) ---
// Veritabanında her bir hilecinin nasıl bir yapıda saklanacağını belirler.
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

// --- 3. WebSocket Sunucusu ---
const port = process.env.PORT || 8080;
const wss = new WebSocket.Server({ port });
console.log(`Sunucu ${port} portunda çalışıyor.`);

// --- 4. Yayın Fonksiyonu ---
// Gelen bir mesajı tüm bağlı kullanıcılara gönderir.
const broadcast = (data) => {
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(data));
        }
    });
};

// --- 5. Ana WebSocket Mantığı ---
wss.on('connection', async ws => {
    console.log('Yeni bir kullanıcı bağlandı.');

    // YENİ ÖZELLİK: Yeni bağlanan kullanıcıya veritabanındaki tüm listeyi gönder
    try {
        const cheaters = await Cheater.find({}); // Veritabanından tüm hilecileri bul
        ws.send(JSON.stringify({ type: 'INITIAL_DATA', data: cheaters }));
    } catch (err) {
        console.error('İlk veri gönderilirken hata:', err);
    }

    // Kullanıcıdan gelen mesajları dinle
    ws.on('message', async message => {
        const parsedMessage = JSON.parse(message);
        const { type, data } = parsedMessage;

        try {
            // YENİ ÖZELLİK: Admin yeni hileci eklediğinde...
            if (type === 'CHEATER_ADDED') {
                const newCheater = new Cheater(data);
                const savedCheater = await newCheater.save(); // Hileciyi veritabanına KAYDET
                console.log('Yeni hileci veritabanına eklendi:', savedCheater.playerName);
                // Kaydedilmiş hileciyi (veritabanından gelen _id ile birlikte) herkese yayınla
                broadcast({ type: 'CHEATER_ADDED', data: savedCheater });
            }
            // (Gelecekte silme ve güncelleme işlemleri de buraya eklenebilir)
        } catch (err) {
            console.error('Mesaj işlenirken hata:', err);
        }
    });

    ws.on('close', () => {
        console.log('Bir kullanıcının bağlantısı kesildi.');
    });
});
