// server.js - SON SÜRÜM (Tüm Özelliklerle Uyumlu)

require('dotenv').config();
const WebSocket = require('ws');
const mongoose = require('mongoose');

// --- Veritabanı Bağlantısı ---
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('MongoDB veritabanına başarıyla bağlanıldı.'))
    .catch(err => console.error('MongoDB bağlantı hatası:', err));

// --- Hileci Veri Modeli (Schema) ---
// Frontend'den gelen tüm yeni özellikleri destekler.
const cheaterSchema = new mongoose.Schema({
    playerName: { type: String, required: true },
    steamId: { type: String, required: true, unique: true }, // SteamID'nin benzersiz olmasını sağlar
    steamProfile: String,
    serverName: { type: String, required: true },
    detectionCount: { type: Number, default: 1 },
    cheatTypes: [String],
    fungunReport: String, // Ana rapor linki
    history: [{ // Her bir tespitin geçmişi
        date: { type: Date, default: Date.now },
        serverName: String,
        cheatTypes: [String],
        reportUrl: String // Her tespitin kendi rapor linki olabilir
    }]
}, { timestamps: true }); // createdAt ve updatedAt alanları ekler

const Cheater = mongoose.model('Cheater', cheaterSchema);

// --- WebSocket Sunucusu ---
const port = process.env.PORT || 8080;
const wss = new WebSocket.Server({ port });
console.log(`Sunucu ${port} portunda çalışıyor.`);

// Herkese mesaj yayınlama fonksiyonu
const broadcast = (data) => {
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(data));
        }
    });
};

// Yeni bir kullanıcı bağlandığında...
wss.on('connection', async ws => {
    console.log('Yeni kullanıcı bağlandı.');
    try {
        // En yeni kayıtlar en üstte olacak şekilde tüm listeyi gönder
        const cheaters = await Cheater.find({}).sort({ createdAt: -1 });
        ws.send(JSON.stringify({ type: 'INITIAL_DATA', data: cheaters }));
    } catch (err) {
        ws.send(JSON.stringify({ type: 'ERROR_OCCURRED', data: { message: 'Veriler yüklenemedi.' } }));
    }

    // Kullanıcıdan bir mesaj geldiğinde...
    ws.on('message', async message => {
        const parsedMessage = JSON.parse(message);
        const { type, data } = parsedMessage;

        try {
            switch (type) {
                // YENİ HİLECİ EKLEME
                case 'CHEATER_ADDED': {
                    const existingCheater = await Cheater.findOne({ steamId: data.steamId });
                    if (existingCheater) {
                        // Eğer hileci zaten varsa, tespit sayısını artır ve geçmişe ekle
                        existingCheater.detectionCount += 1;
                        existingCheater.serverName = data.serverName; // Son sunucuyu güncelle
                        existingCheater.history.push({
                            serverName: data.serverName,
                            cheatTypes: data.cheatTypes,
                            reportUrl: data.fungunReport
                        });
                        const updatedCheater = await existingCheater.save();
                        broadcast({ type: 'CHEATER_UPDATED', data: updatedCheater });
                    } else {
                        // Eğer hileci yeni ise, veritabanına kaydet
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

                // HİLECİ GÜNCELLEME
                case 'CHEATER_UPDATED': {
                    // Güncelleme için _id kullanılır, bu en güvenilir yöntemdir.
                    const updatedCheater = await Cheater.findByIdAndUpdate(data._id, data, { new: true });
                    broadcast({ type: 'CHEATER_UPDATED', data: updatedCheater });
                    break;
                }

                // HİLECİ SİLME
                case 'CHEATER_DELETED': {
                    // Silme için _id kullanılır.
                    const deletedCheater = await Cheater.findByIdAndDelete(data._id);
                    if (deletedCheater) {
                        broadcast({ type: 'CHEATER_DELETED', data: { _id: data._id } });
                    }
                    break;
                }
                
                // VERİ İÇE AKTARMA (YENİ)
                case 'IMPORT_DATA': {
                    // Toplu veri aktarımı
                    const importPromises = data.map(cheaterData => 
                        Cheater.findOneAndUpdate(
                            { steamId: cheaterData.steamId }, // Bu SteamID'yi bul
                            cheaterData,                      // Bu veriyle güncelle
                            { upsert: true, new: true }       // Eğer yoksa, yeni oluştur
                        )
                    );
                    await Promise.all(importPromises);
                    // Tüm veriyi yeniden herkese gönder
                    const allCheaters = await Cheater.find({}).sort({ createdAt: -1 });
                    broadcast({ type: 'INITIAL_DATA', data: allCheaters });
                    break;
                }
            }
        } catch (err) {
            console.error('İşlem sırasında hata:', err);
            ws.send(JSON.stringify({ type: 'ERROR_OCCURRED', data: { message: 'İşlem sırasında bir hata oluştu.' } }));
        }
    });

    ws.on('close', () => console.log('Bir kullanıcının bağlantısı kesildi.'));
});
