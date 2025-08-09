// server.js - Düzeltilmiş Sürüm (Daha İyi Hata Yönetimi)

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
    steamId: { type: String, required: true, unique: true },
    steamProfile: String,
    serverName: { type: String, required: true },
    detectionCount: { type: Number, default: 1 },
    cheatTypes: [String],
    fungunReport: String,
    history: [{
        date: { type: Date, default: Date.now },
        serverName: String,
        cheatTypes: [String],
        reportUrl: String
    }]
}, { timestamps: true });

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
        console.error("İlk veri gönderim hatası:", err);
        ws.send(JSON.stringify({ type: 'ERROR_OCCURRED', data: { message: 'Veriler yüklenemedi.' } }));
    }

    ws.on('message', async message => {
        const parsedMessage = JSON.parse(message);
        const { type, data } = parsedMessage;

        try {
            switch (type) {
                case 'CHEATER_ADDED': {
                    const existingCheater = await Cheater.findOne({ steamId: data.steamId });
                    if (existingCheater) {
                        existingCheater.detectionCount += 1;
                        existingCheater.serverName = data.serverName;
                        existingCheater.history.push({
                            serverName: data.serverName,
                            cheatTypes: data.cheatTypes,
                            reportUrl: data.fungunReport
                        });
                        const updatedCheater = await existingCheater.save();
                        broadcast({ type: 'CHEATER_UPDATED', data: updatedCheater });
                    } else {
                        const newCheater = new Cheater({
                            ...data,
                            history: [{
                                serverName: data.serverName,
                                cheatTypes: data.cheatTypes,
                                reportUrl: data.fungunReport
                            }]
                        });
                        const savedCheater = await newCheater.save();
                        broadcast({ type: 'CHEATER_ADDED', data: savedCheater });
                    }
                    break;
                }

                case 'CHEATER_UPDATED': {
                    const updatedCheater = await Cheater.findByIdAndUpdate(data._id, data, { new: true });
                    if (updatedCheater) {
                        broadcast({ type: 'CHEATER_UPDATED', data: updatedCheater });
                    } else {
                         ws.send(JSON.stringify({ type: 'ERROR_OCCURRED', data: { message: 'Güncellenecek hileci bulunamadı.' } }));
                    }
                    break;
                }

                case 'CHEATER_DELETED': {
                    // DÜZELTME BURADA BAŞLIYOR
                    const deletedCheater = await Cheater.findByIdAndDelete(data._id);
                    if (deletedCheater) {
                        // Eğer silme başarılıysa, herkese haber ver.
                        console.log('Hileci silindi:', deletedCheater.playerName);
                        broadcast({ type: 'CHEATER_DELETED', data: { _id: data._id } });
                    } else {
                        // Eğer o ID ile bir hileci bulunamazsa, sadece komutu gönderen kullanıcıya hata mesajı gönder.
                        console.log('Silinecek hileci bulunamadı, ID:', data._id);
                        ws.send(JSON.stringify({ type: 'ERROR_OCCURRED', data: { message: 'Silinecek hileci veritabanında bulunamadı.' } }));
                    }
                    // DÜZELTME BURADA BİTİYOR
                    break;
                }
                
                case 'IMPORT_DATA': {
                    const importPromises = data.map(cheaterData => 
                        Cheater.findOneAndUpdate(
                            { steamId: cheaterData.steamId },
                            cheaterData,
                            { upsert: true, new: true }
                        )
                    );
                    await Promise.all(importPromises);
                    const allCheaters = await Cheater.find({}).sort({ createdAt: -1 });
                    broadcast({ type: 'INITIAL_DATA', data: allCheaters });
                    break;
                }
            }
        } catch (err) {
            // Herhangi bir beklenmedik hata olursa, komutu gönderen kullanıcıya haber ver.
            console.error('İşlem sırasında hata:', err);
            ws.send(JSON.stringify({ type: 'ERROR_OCCURRED', data: { message: 'Sunucuda beklenmedik bir hata oluştu.' } }));
        }
    });

    ws.on('close', () => console.log('Bir kullanıcının bağlantısı kesildi.'));
});
