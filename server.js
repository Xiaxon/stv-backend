// Gerekli kütüphaneler
require('dotenv').config();
const http = require('http');
const express = require('express');
const WebSocket = require('ws');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const cors = require('cors');

// --- Güvenli Bilgileri Render Environment'dan Okuma ---
// Bu değişkenleri kullanabilmek için Render'da Environment Variables (Ortam Değişkenleri) olarak ayarlamanız gerekir.
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const JWT_SECRET = process.env.JWT_SECRET;
const PORT = process.env.PORT || 8080;
const MONGO_URI = process.env.MONGO_URI;

// --- Express App ve Sunucu Kurulumu ---
const app = express();
app.use(cors());
// Gelen isteğin IP adresini alabilmek için proxy trust ayarı (Render gibi platformlar için gereklidir)
app.set('trust proxy', 1); 
app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// --- Veritabanı Bağlantısı ---
mongoose.connect(MONGO_URI)
    .then(() => console.log('MongoDB veritabanına başarıyla bağlanıldı.'))
    .catch(err => console.error('MongoDB bağlantı hatası:', err));

// --- Veri Modelleri (Schema) ---

// 1. Hileci Veri Modeli
const cheaterSchema = new mongoose.Schema({
    playerName: { type: String, required: true },
    steamId: { type: String, required: true, unique: true },
    steamProfile: String,
    serverName: { type: String, required: true },
    detectionCount: { type: Number, default: 1 },
    cheatTypes: [String],
    fungunReport: String,
    createdAt: { type: Date, default: Date.now },
    history: [{
        _id: { type: mongoose.Schema.Types.ObjectId, auto: true },
        date: { type: Date, default: Date.now },
        playerName: String,
        steamId: String,
        steamProfile: String,
        serverName: String,
        cheatTypes: [String],
        fungunReport: String,
    }],
}, { timestamps: true });
const Cheater = mongoose.model('Cheater', cheaterSchema);

// 2. 5V5 Maç Bileti Veri Modeli (YENİ)
const ticketSchema = new mongoose.Schema({
    clanName: { type: String, required: true },
    contactInfo: { type: String, required: true },
    schedule: String,
    mapPreference: [String], // Virgülden ayırıp diziye çevireceğiz
    notes: String,
    status: { type: String, default: 'Açık' }, // 'Açık', 'Eşleşti'
    createdAt: { type: Date, default: Date.now },
    challengerInfo: {
        clanName: String,
        contactInfo: String,
        acceptedAt: Date
    }
}, { timestamps: true });
const MatchTicket = mongoose.model('MatchTicket', ticketSchema);


// --- Yardımcı Fonksiyonlar ---

// WebSocket'e bağlı tüm client'lara mesaj yayınlar
function broadcast(data) {
    const message = JSON.stringify(data);
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    });
}

// Token'ı doğrular ve admin yetkisi verir
const verifyAdmin = (token) => {
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        return decoded.role === 'admin';
    } catch (err) {
        return false;
    }
};

// Basit IP Tabanlı Hız Sınırlama (Rate Limiting)
const rateLimitStore = {};
const TICKET_LIMIT_SECONDS = 60 * 5; // 5 dakika

const rateLimitMiddleware = (req, res, next) => {
    const ip = req.ip; 
    const now = Date.now();

    // 5 dakikalık süre dolmadan tekrar bilet açmaya çalışıyorsa
    if (rateLimitStore[ip] && (now - rateLimitStore[ip]) < (TICKET_LIMIT_SECONDS * 1000)) {
        const remainingTimeSeconds = Math.ceil((TICKET_LIMIT_SECONDS * 1000 - (now - rateLimitStore[ip])) / 1000);
        const remainingMinutes = Math.ceil(remainingTimeSeconds / 60);
        return res.status(429).json({ message: `Çok hızlı bilet açıyorsunuz. Lütfen ${remainingMinutes} dakika sonra tekrar deneyin.` });
    }
    
    // Geçerli IP'yi zaman damgasıyla kaydet
    rateLimitStore[ip] = now;
    next();
};


// --- Express API Rotaları ---

// Admin Giriş
app.post('/login', (req, res) => {
    const { password } = req.body;
    if (password === ADMIN_PASSWORD) {
        const token = jwt.sign({ role: 'admin' }, JWT_SECRET, { expiresIn: '8h' });
        res.json({ token });
    } else {
        res.status(401).json({ message: 'Yetkilendirme başarısız.' });
    }
});


// YENİ ROTA: 5V5 Maç Bileti Oluşturma
app.post('/api/tickets', rateLimitMiddleware, async (req, res) => {
    try {
        const { clanName, contactInfo, schedule, mapPreference, notes } = req.body;

        // Harita tercihlerini temizle ve diziye çevir
        const mapsArray = mapPreference ? mapPreference.split(',').map(m => m.trim()).filter(Boolean) : [];

        const newTicket = new MatchTicket({
            clanName,
            contactInfo,
            schedule,
            mapPreference: mapsArray,
            notes,
            status: 'Açık'
        });

        const savedTicket = await newTicket.save();

        // Anlık olarak tüm istemcilere bildir
        broadcast({ type: 'MATCH_TICKET_ADDED', data: savedTicket });

        res.status(201).json(savedTicket);
    } catch (err) {
        console.error('Bilet oluşturma hatası:', err);
        res.status(500).json({ message: 'Sunucuda bir hata oluştu.' });
    }
});

// YENİ ROTA: Maç Bileti Kabul Etme (Eşleştirme)
app.put('/api/tickets/:id/accept', async (req, res) => {
    try {
        const ticketId = req.params.id;
        const { clanName, contactInfo } = req.body;

        if (!clanName || !contactInfo) {
            return res.status(400).json({ message: 'Klan adı ve iletişim bilgisi zorunludur.' });
        }

        // Biletin mevcut durumunu kontrol et
        const existingTicket = await MatchTicket.findById(ticketId);
        if (!existingTicket) {
             return res.status(404).json({ message: 'Bilet bulunamadı.' });
        }
        if (existingTicket.status !== 'Açık') {
             return res.status(400).json({ message: 'Bu bilet zaten eşleşti veya kapatıldı.' });
        }

        const updatedTicket = await MatchTicket.findByIdAndUpdate(
            ticketId,
            {
                $set: {
                    status: 'Eşleşti',
                    challengerInfo: {
                        clanName,
                        contactInfo,
                        acceptedAt: new Date()
                    }
                }
            },
            { new: true } // Güncellenmiş dokümanı döndür
        );

        
        // Bilet listesi güncelleneceği için anlık bildirim gönder
        broadcast({ type: 'MATCH_TICKET_UPDATED', data: updatedTicket });

        res.json(updatedTicket);
    } catch (err) {
        console.error('Bilet kabul etme hatası:', err);
        res.status(500).json({ message: 'Sunucuda bir hata oluştu.' });
    }
});


// --- WebSocket İşlemleri ---

wss.on('connection', async (ws, req) => {
    // İlk bağlantıda tüm verileri gönder
    try {
        // Hilecileri tespit sayısına göre azalan, sonra oluşturulma tarihine göre azalan sırada getir
        const cheaters = await Cheater.find().sort({ detectionCount: -1, createdAt: -1 });
        // Açık olan biletleri en yenisi en üstte olacak şekilde getir
        const openTickets = await MatchTicket.find({ status: 'Açık' }).sort({ createdAt: -1 });

        ws.send(JSON.stringify({ type: 'INITIAL_DATA', data: { cheaters, openTickets } }));

        // Kullanıcı sayısını güncelle
        broadcast({ type: 'USER_COUNT_UPDATE', data: { count: wss.clients.size } });

        ws.on('message', async (message) => {
            let data;
            try {
                data = JSON.parse(message);
            } catch (e) {
                console.error('Geçersiz JSON alındı:', message);
                return;
            }

            // Sadece admin işlemlerini yetkilendir
            if (data.token && verifyAdmin(data.token)) {
                await handleAdminAction(data, ws);
            } else if (data.token) {
                // Hatalı token ile admin işlemi yapmaya çalışanı bilgilendir
                ws.send(JSON.stringify({ type: 'ERROR_OCCURRED', data: { message: 'Yetkiniz yok.' } }));
            }
        });

    } catch (err) {
        console.error('WS bağlantı hatası:', err);
    }

    ws.on('close', () => {
        // Kullanıcı ayrıldığında sayıyı güncelle
        broadcast({ type: 'USER_COUNT_UPDATE', data: { count: wss.clients.size } });
    });
});

// Admin aksiyonlarını ele alır
async function handleAdminAction(data, ws) {
    try {
        switch (data.type) {
            case 'CHEATER_ADDED': {
                const { playerName, steamId, steamProfile, serverName, cheatTypes, fungunReport } = data.data;

                // Geçmiş kaydı oluştur
                const initialHistory = {
                    playerName,
                    steamId,
                    steamProfile,
                    serverName,
                    cheatTypes,
                    fungunReport,
                    date: new Date()
                };

                const newCheater = new Cheater({
                    playerName,
                    steamId,
                    steamProfile,
                    serverName,
                    detectionCount: 1,
                    cheatTypes,
                    fungunReport,
                    history: [initialHistory]
                });

                const savedCheater = await newCheater.save();
                broadcast({ type: 'CHEATER_ADDED', data: savedCheater });
                break;
            }
            case 'CHEATER_DELETED': {
                const { _id } = data.data;
                const deletedCheater = await Cheater.findByIdAndDelete(_id);
                if (deletedCheater) {
                    broadcast({ type: 'CHEATER_DELETED', data: { _id } });
                }
                break;
            }
            case 'CHEATER_UPDATED': {
                const { _id, ...updateData } = data.data;
                const cheater = await Cheater.findById(_id);

                if (cheater) {
                    // Ana kaydı güncelle
                    // MongoDB'deki history alanını korumak için sadece ana alanları güncelliyoruz
                    cheater.playerName = updateData.playerName;
                    cheater.steamId = updateData.steamId;
                    cheater.steamProfile = updateData.steamProfile;
                    cheater.serverName = updateData.serverName;
                    cheater.detectionCount = updateData.detectionCount;
                    cheater.cheatTypes = updateData.cheatTypes;
                    cheater.fungunReport = updateData.fungunReport;
                    
                    // Yeni bir geçmiş kaydı eklemek için kontrol yapıyoruz
                    const lastHistory = cheater.history.length > 0 ? cheater.history[cheater.history.length - 1] : null;
                    const isNewEntryRequired = !lastHistory || 
                        lastHistory.playerName !== updateData.playerName ||
                        lastHistory.steamId !== updateData.steamId ||
                        lastHistory.serverName !== updateData.serverName ||
                        updateData.detectionCount > cheater.history.length; // Tespit sayısı geçmiş kaydından fazlaysa yeni kayıt eklenir.

                    if (isNewEntryRequired) {
                        // Yeni tespit veya ana verilerde anlamlı bir değişiklik varsa geçmişe ekle
                        cheater.history.push({
                            playerName: updateData.playerName,
                            steamId: updateData.steamId,
                            steamProfile: updateData.steamProfile,
                            serverName: updateData.serverName,
                            cheatTypes: updateData.cheatTypes,
                            fungunReport: updateData.fungunReport,
                            date: new Date(),
                        });
                    }
                    
                    const updatedCheater = await cheater.save();
                    // Frontend'deki WebSocket bağlantılarına güncel veriyi gönder
                    broadcast({ type: 'CHEATER_UPDATED', data: updatedCheater });
                }
                break;
            }
            // NOT: HISTORY_ENTRY_DELETED/UPDATED gibi detaylı geçmiş işlemleri bu versiyonda devre dışı bırakılmıştır.
        }
    } catch (err) {
        console.error('Admin işlemi sırasında hata:', err);
        ws.send(JSON.stringify({ type: 'ERROR_OCCURRED', data: { message: 'Sunucuda beklenmedik bir hata oluştu.' } }));
    }
}

server.listen(PORT, () => {
    console.log(`Sunucu ${PORT} portunda çalışıyor.`);
});
