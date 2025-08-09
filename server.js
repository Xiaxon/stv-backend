// server.js - Final Sürüm (Silme ve Güncelleme Özellikli)
require('dotenv').config();
const WebSocket = require('ws');
const mongoose = require('mongoose');

// --- Veritabanı Bağlantısı ---
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('MongoDB veritabanına başarıyla bağlanıldı.'))
    .catch(err => console.error('MongoDB bağlantı hatası:', err));

// --- Hileci Veri Modeli (Schema) Güncellemesi ---
const cheaterSchema = new mongoose.Schema({
    playerName: { type: String, required: true },
    steamId: { type: String, required: true, unique: true }, // SteamID'yi benzersiz yaptık
    steamProfile: String,
    serverName: { type: String, required: true },
    detectionCount: { type: Number, default: 1 },
    cheatTypes: [String],
    fungunReports: [String], // Tek rapor yerine raporlar dizisi
    history: [{ // Tespit geçmişi için
        date: { type: Date, default: Date.now },
        serverName: String,
        cheatTypes: [String]
    }]
}, { timestamps: true }); // createdAt ve updatedAt alanları ekler
const Cheater = mongoose.model('Cheater', cheaterSchema);

// --- WebSocket Sunucusu ---
const port = process.env.PORT || 8080;
const wss = new WebSocket.Server({ port });
console.log(`Sunucu ${port} portunda çalışıyor.`);

const broadcast = (data) => {
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(data));
        }
    });
};

wss.on('connection', async ws => {
    console.log('Yeni kullanıcı bağlandı.');
    try {
        const cheaters = await Cheater.find({}).sort({ createdAt: -1 });
        ws.send(JSON.stringify({ type: 'INITIAL_DATA', data: cheaters }));
    } catch (err) {
        console.error('İlk veri gönderilirken hata:', err);
        ws.send(JSON.stringify({ type: 'ERROR_OCCURRED', data: { message: 'Veriler yüklenemedi.' } }));
    }

    ws.on('message', async message => {
        const parsedMessage = JSON.parse(message);
        const { type, data } = parsedMessage;

        try {
            switch (type) {
                case 'CHEATER_ADDED': {
                    // Aynı Steam ID'ye sahip biri var mı diye kontrol et
                    const existingCheater = await Cheater.findOne({ steamId: data.steamId });
                    if (existingCheater) {
                        // Eğer varsa, yeni bir hileci eklemek yerine mevcut olanı güncelle
                        existingCheater.detectionCount += 1;
                        existingCheater.history.push({ serverName: data.serverName, cheatTypes: data.cheatTypes });
                        existingCheater.serverName = data.serverName; // Son sunucuyu güncelle
                        if (data.fungunReports && data.fungunReports.length > 0) {
                            existingCheater.fungunReports.push(...data.fungunReports);
                        }
                        const updatedCheater = await existingCheater.save();
                        console.log('Mevcut hileci güncellendi:', updatedCheater.playerName);
                        broadcast({ type: 'CHEATER_UPDATED', data: updatedCheater });
                    } else {
                        // Eğer yoksa, yeni hileci oluştur
                        const newCheater = new Cheater({
                            ...data,
                            history: [{ serverName: data.serverName, cheatTypes: data.cheatTypes }]
                        });
                        const savedCheater = await newCheater.save();
                        console.log('Yeni hileci veritabanına eklendi:', savedCheater.playerName);
                        broadcast({ type: 'CHEATER_ADDED', data: savedCheater });
                    }
                    break;
                }

                case 'CHEATER_UPDATED': {
                    const updatedCheater = await Cheater.findByIdAndUpdate(data._id, data, { new: true });
                    console.log('Hileci güncellendi:', updatedCheater.playerName);
                    broadcast({ type: 'CHEATER_UPDATED', data: updatedCheater });
                    break;
                }

                case 'CHEATER_DELETED': {
                    const deletedCheater = await Cheater.findByIdAndDelete(data._id);
                    console.log('Hileci silindi:', deletedCheater.playerName);
                    broadcast({ type: 'CHEATER_DELETED', data: { _id: data._id } });
                    break;
                }
            }
        } catch (err) {
            console.error('Mesaj işlenirken hata:', err);
            ws.send(JSON.stringify({ type: 'ERROR_OCCURRED', data: { message: 'İşlem sırasında bir hata oluştu.' } }));
        }
    });

    ws.on('close', () => console.log('Bir kullanıcının bağlantısı kesildi.'));
});
