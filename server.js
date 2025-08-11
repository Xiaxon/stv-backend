// Gerekli kütüphaneler (değişiklik yok)
require('dotenv').config();
const http = require('http');
const express = require('express');
const WebSocket = require('ws');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const cors = require('cors');

// --- Güvenli Bilgiler (değişiklik yok) ---
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const JWT_SECRET = process.env.JWT_SECRET;
const PORT = process.env.PORT || 8080;
const MONGO_URI = process.env.MONGO_URI;

// --- Kurulumlar (değişiklik yok) ---
const app = express();
app.use(cors());
app.use(express.json());
mongoose.connect(MONGO_URI)
    .then(() => console.log('MongoDB veritabanına başarıyla bağlanıldı.'))
    .catch(err => console.error('MongoDB bağlantı hatası:', err));

// --- Hileci Veri Modeli (Schema) (değişiklik yok) ---
const cheaterSchema = new mongoose.Schema({ /* ...içerik aynı... */ });
const Cheater = mongoose.model('Cheater', cheaterSchema);

// --- Login Endpoint'i (değişiklik yok) ---
app.post('/login', async (req, res) => { /* ...içerik aynı... */ });

// --- WebSocket Sunucusu ---
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const broadcast = (data) => { /* ...içerik aynı... */ };

wss.on('connection', async (ws) => {
    // ...bağlantı kısmı aynı...
    
    ws.on('message', async (message) => {
        try {
            const parsedMessage = JSON.parse(message);
            const { type, data, token } = parsedMessage;
            
            // GÜNCELLEME: adminActions listesine yeni işlem eklendi
            const adminActions = ['CHEATER_ADDED', 'CHEATER_UPDATED', 'CHEATER_DELETED', 'HISTORY_ENTRY_DELETED', 'HISTORY_ENTRY_UPDATED'];

            if (adminActions.includes(type)) {
                // ...token doğrulama kısmı aynı...
                jwt.verify(token, JWT_SECRET, async (err, decoded) => {
                    if (err) { /* ...hata yönetimi aynı... */ }
                    await handleAdminAction(ws, type, data);
                });
            }
        } catch (err) { /* ...hata yönetimi aynı... */ }
    });
    
    ws.on('close', () => console.log('Bir kullanıcının bağlantısı kesildi.'));
});

// GÜNCELLENDİ: Admin işlemlerini yöneten ana fonksiyon
async function handleAdminAction(ws, type, data) {
    try {
        switch (type) {
            case 'CHEATER_ADDED': { /* ...içerik aynı... */ break; }
            case 'CHEATER_UPDATED': { /* ...içerik aynı... */ break; }
            case 'CHEATER_DELETED': { /* ...içerik aynı... */ break; }
            
            case 'HISTORY_ENTRY_DELETED': {
                const { cheaterId, historyId } = data;
                const cheater = await Cheater.findById(cheaterId);
                if (cheater) {
                    cheater.history.id(historyId)?.remove(); // ?. ile daha güvenli
                    cheater.detectionCount = cheater.history.length + 1;
                    const updatedCheater = await cheater.save();
                    broadcast({ type: 'HISTORY_ENTRY_DELETED', data: updatedCheater });
                }
                break;
            }
            
            // YENİ EKLENEN ÖZELLİK: Tespit Geçmişi Düzenleme
            case 'HISTORY_ENTRY_UPDATED': {
                const { cheaterId, historyId, updatedHistoryData } = data;
                const cheater = await Cheater.findById(cheaterId);
                if (cheater) {
                    const historyEntry = cheater.history.id(historyId);
                    if (historyEntry) {
                        historyEntry.serverName = updatedHistoryData.serverName;
                        historyEntry.cheatTypes = updatedHistoryData.cheatTypes;
                    }
                    const updatedCheater = await cheater.save();
                    broadcast({ type: 'HISTORY_ENTRY_UPDATED', data: updatedCheater });
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
