const WebSocket = require('ws');

const port = process.env.PORT || 8080;
const wss = new WebSocket.Server({ port });

console.log(`Canlı veri sunucusu ${port} portunda çalışmaya başladı.`);

wss.on('connection', ws => {
    console.log('Yeni bir kullanıcı bağlandı.');

    ws.on('message', message => {
        console.log('Mesaj alındı ve yayınlanıyor...');
        wss.clients.forEach(client => {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
                client.send(message.toString());
            }
        });
    });

    ws.on('close', () => {
        console.log('Bir kullanıcının bağlantısı kesildi.');
    });
});
