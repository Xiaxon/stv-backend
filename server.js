// --- Global Değişkenler ---
let cheaters = [];
let openTickets = []; // YENİ: Açık biletleri tutar
let authToken = sessionStorage.getItem('stvAuthToken') || null;
let sortColumn = 'createdAt';
let sortDirection = 'desc';
let socket = null;
let editingCheater = null;
let editingHistory = null;
let confirmCallback = null;
let isTicketModalOpen = false;

// Render'da deploy ettiğiniz backend URL'niz
// Lütfen bu URL'yi kendi Render adresinizle güncelleyin.
const WS_URL = 'wss://stv-backend.onrender.com'; 
const API_BASE_URL = 'https://stv-backend.onrender.com';

// --- Sayfa Yüklendiğinde Başlat ---
document.addEventListener('DOMContentLoaded', () => {
    setupEventListeners();
    connectWebSocket();
    showWelcomeModal();
    if (authToken) {
        updateAdminUI();
    }
});

// --- Olay Dinleyicileri ---
function setupEventListeners() {
    // Genel
    document.getElementById('closeModalBtn').addEventListener('click', closeWelcomeModal);
    document.getElementById('cheaterSearch').addEventListener('input', renderCheaters);
    
    // Admin
    document.getElementById('adminBtn').addEventListener('click', toggleAdminPanel);
    document.getElementById('quickAddBtn').addEventListener('click', showAdminPanel);
    document.getElementById('adminLoginBtn').addEventListener('click', handleAdminLogin);
    document.getElementById('adminCancelBtn').addEventListener('click', closeAdminLoginModal);
    document.getElementById('adminCloseBtn').addEventListener('click', closeAdminPanel);
    
    // Hileci Ekleme/Düzenleme Formları
    document.getElementById('editCancelBtn').addEventListener('click', closeEditModal);
    document.getElementById('cheaterEditForm').addEventListener('submit', handleCheaterEditSubmit);
    document.getElementById('addCheaterForm').addEventListener('submit', handleAddCheaterSubmit);

    // Sıralama
    document.querySelectorAll('.stv-table-header[data-sort]').forEach(header => {
        header.addEventListener('click', () => {
            const column = header.getAttribute('data-sort');
            handleSort(column);
        });
    });

    // Onay Kutusu
    document.getElementById('confirmYes').addEventListener('click', handleConfirmYes);
    document.getElementById('confirmNo').addEventListener('click', closeConfirmModal);

    // YENİ: Bilet İşlemleri
    document.getElementById('openTicketModalBtn').addEventListener('click', showTicketModal);
    document.getElementById('closeTicketModalBtn').addEventListener('click', closeTicketModal);
    document.getElementById('ticketSubmissionForm').addEventListener('submit', handleTicketSubmission);
    document.getElementById('acceptTicketForm').addEventListener('submit', handleAcceptTicketSubmit);
    document.getElementById('acceptCancelBtn').addEventListener('click', closeAcceptTicketModal);
}

// --- Modallar ---

function showWelcomeModal() {
    document.getElementById('welcomeModal').style.display = 'flex';
}

function closeWelcomeModal() {
    document.getElementById('welcomeModal').style.display = 'none';
}

function closeAdminLoginModal() {
    document.getElementById('adminLoginModal').style.display = 'none';
}

function showAdminPanel() {
    if (!authToken) {
        document.getElementById('adminLoginModal').style.display = 'flex';
    } else {
        document.getElementById('adminPanel').style.display = 'flex';
    }
}

function closeAdminPanel() {
    document.getElementById('adminPanel').style.display = 'none';
}

function toggleAdminPanel() {
    if (document.getElementById('adminPanel').style.display === 'flex') {
        closeAdminPanel();
    } else {
        showAdminPanel();
    }
}

function showEditModal(cheaterId) {
    editingCheater = cheaters.find(c => c._id === cheaterId);
    if (!editingCheater) return;

    // Hileci Ana Bilgileri
    document.getElementById('editCheaterId').value = editingCheater._id;
    document.getElementById('editPlayerName').value = editingCheater.playerName;
    document.getElementById('editSteamId').value = editingCheater.steamId;
    document.getElementById('editSteamProfile').value = editingCheater.steamProfile || '';
    document.getElementById('editServerName').value = editingCheater.serverName;
    document.getElementById('editDetectionCount').value = editingCheater.detectionCount;
    document.getElementById('editCheatTypes').value = (editingCheater.cheatTypes || []).join(', ');
    document.getElementById('editFungunReport').value = editingCheater.fungunReport || '';

    // Geçmiş Bölümünü Hazırla
    renderHistory();

    document.getElementById('editModal').style.display = 'flex';
}

function closeEditModal() {
    editingCheater = null;
    editingHistory = null;
    document.getElementById('editModal').style.display = 'none';
}

function showConfirmModal(message, callback) {
    document.getElementById('confirmMessage').textContent = message;
    confirmCallback = callback;
    document.getElementById('confirmModal').style.display = 'flex';
}

function closeConfirmModal() {
    document.getElementById('confirmModal').style.display = 'none';
    confirmCallback = null;
}

function handleConfirmYes() {
    if (confirmCallback) {
        confirmCallback();
    }
    closeConfirmModal();
}

// YENİ MODAL: Bilet Açma Modalı
function showTicketModal() {
    document.getElementById('ticketModal').style.display = 'flex';
    isTicketModalOpen = true;
}

function closeTicketModal() {
    document.getElementById('ticketModal').style.display = 'none';
    document.getElementById('ticketSubmissionForm').reset(); // Formu temizle
    document.getElementById('ticketSubmissionMessage').textContent = ''; // Mesajı temizle
    isTicketModalOpen = false;
}

let currentAcceptTicketId = null;

// YENİ MODAL: Bilet Kabul Etme Modalı
function showAcceptTicketModal(ticketId, openerClanName) {
    currentAcceptTicketId = ticketId;
    document.getElementById('acceptTicketClanNameOpener').textContent = openerClanName;
    document.getElementById('acceptTicketModal').style.display = 'flex';
}

function closeAcceptTicketModal() {
    currentAcceptTicketId = null;
    document.getElementById('acceptTicketModal').style.display = 'none';
    document.getElementById('acceptTicketForm').reset();
    document.getElementById('acceptMessage').textContent = '';
}


// --- Admin/Yetkilendirme ---

function updateAdminUI() {
    const isLoggedIn = !!authToken;

    // Hileci tablosu başlığını güncelle (İşlemler sütununu göster/gizle)
    document.getElementById('actionsHeader').style.display = isLoggedIn ? 'table-cell' : 'none';
    
    // Hileci tablosunun içeriğini yeniden render et (İşlemler butonları için)
    renderCheaters();

    // Admin paneli butonu metnini ve işlevini güncelle
    const adminBtn = document.getElementById('adminBtn');
    adminBtn.textContent = isLoggedIn ? 'ADMİN (Giriş Yapıldı)' : 'ADMİN GİRİŞ';
    adminBtn.classList.toggle('logged-in', isLoggedIn);

    // Ekleme butonu için ikon değiştir
    const quickAddBtn = document.getElementById('quickAddBtn');
    if (quickAddBtn) {
        quickAddBtn.innerHTML = isLoggedIn ? '<i class="fas fa-plus mr-1"></i> Ekle' : '<i class="fas fa-user-lock mr-1"></i> ADMİN';
    }

    // Konsola token bilgisini yazdır
    if (isLoggedIn) {
        console.log('Admin oturumu aktif.');
    } else {
        console.log('Admin oturumu kapalı.');
    }
}

async function handleAdminLogin(event) {
    event.preventDefault();
    const password = document.getElementById('adminPassword').value;

    try {
        const response = await fetch(`${API_BASE_URL}/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password })
        });

        const data = await response.json();

        if (response.ok) {
            authToken = data.token;
            sessionStorage.setItem('stvAuthToken', data.token);
            closeAdminLoginModal();
            showAdminPanel();
            updateAdminUI();
            showToast('Giriş başarılı!', 'success');
        } else {
            showToast(data.message || 'Yetkilendirme başarısız.', 'error');
        }
    } catch (error) {
        console.error('Giriş hatası:', error);
        showToast('Sunucu bağlantı hatası.', 'error');
    }
}

// --- WebSocket Bağlantısı ve Veri İşleme ---

function connectWebSocket() {
    if (socket && socket.readyState === WebSocket.OPEN) return;

    socket = new WebSocket(WS_URL);

    socket.onopen = () => {
        console.log('WebSocket bağlantısı kuruldu.');
    };

    socket.onmessage = (event) => {
        const message = JSON.parse(event.data);
        handleWebSocketMessage(message);
    };

    socket.onclose = () => {
        console.warn('WebSocket bağlantısı kapandı. 5 saniye sonra tekrar deneniyor...');
        setTimeout(connectWebSocket, 5000);
    };

    socket.onerror = (error) => {
        console.error('WebSocket hatası:', error);
    };
}

function handleWebSocketMessage(message) {
    const { type, data } = message;

    switch (type) {
        case 'INITIAL_DATA':
            cheaters = data.cheaters;
            openTickets = data.openTickets; // YENİ: Başlangıç bilet verisi
            renderCheaters();
            renderTickets(); // YENİ: Biletleri render et
            updateCheaterCount();
            break;
        case 'CHEATER_ADDED':
            cheaters.unshift(data);
            renderCheaters();
            updateCheaterCount();
            showToast(`${data.playerName} listeye eklendi!`, 'info');
            break;
        case 'CHEATER_UPDATED':
            const indexU = cheaters.findIndex(c => c._id === data._id);
            if (indexU !== -1) {
                cheaters[indexU] = data;
                renderCheaters();
                showToast(`${data.playerName} güncellendi!`, 'info');
            }
            break;
        case 'CHEATER_DELETED':
            cheaters = cheaters.filter(c => c._id !== data._id);
            renderCheaters();
            updateCheaterCount();
            showToast('Kayıt silindi.', 'error');
            break;
        case 'USER_COUNT_UPDATE':
            document.getElementById('userCountDisplay').textContent = data.count;
            break;

        // YENİ: Bilet Mesajları
        case 'MATCH_TICKET_ADDED':
            // Yeni bileti listenin başına ekle
            openTickets.unshift(data);
            renderTickets();
            showToast(`Yeni bir maç bileti açıldı! (${data.clanName})`, 'success');
            break;
        case 'MATCH_TICKET_UPDATED':
            // Güncellenmiş bileti listeden çıkar
            openTickets = openTickets.filter(t => t._id !== data._id);
            renderTickets();
            showToast(`Bir maç bileti eşleşti ve kapatıldı!`, 'success');
            break;

        case 'ERROR_OCCURRED':
            console.error('Sunucu Hatası:', data.message);
            showToast(data.message, 'error');
            break;
    }
}

function sendAdminAction(type, data) {
    if (socket && socket.readyState === WebSocket.OPEN && authToken) {
        socket.send(JSON.stringify({ type, data, token: authToken }));
    } else if (!authToken) {
        showToast('Admin yetkiniz yok. Lütfen giriş yapın.', 'error');
    } else {
        showToast('WebSocket bağlantısı kurulamadı. Tekrar deneniyor...', 'error');
        connectWebSocket();
    }
}

// --- Hileci Listesi İşlemleri ---

function renderCheaters() {
    const tableBody = document.getElementById('cheaterTableBody');
    const searchTerm = document.getElementById('cheaterSearch').value.toLowerCase();
    const isLoggedIn = !!authToken;
    
    // Arama ve Sıralama
    let filteredCheaters = cheaters.filter(cheater => {
        return (
            cheater.playerName.toLowerCase().includes(searchTerm) ||
            cheater.steamId.toLowerCase().includes(searchTerm) ||
            (cheater.steamProfile || '').toLowerCase().includes(searchTerm) ||
            cheater.serverName.toLowerCase().includes(searchTerm)
        );
    });

    filteredCheaters.sort((a, b) => {
        let comparison = 0;
        const aVal = a[sortColumn];
        const bVal = b[sortColumn];

        if (typeof aVal === 'number') {
            comparison = aVal - bVal;
        } else {
            comparison = (aVal || '').toString().localeCompare((bVal || '').toString());
        }

        return sortDirection === 'desc' ? comparison * -1 : comparison;
    });

    if (filteredCheaters.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="8" class="text-center py-5 text-gray-400">Aradığınız kriterlere uygun hileci bulunamadı.</td></tr>`;
        return;
    }

    // Tabloyu oluştur
    tableBody.innerHTML = filteredCheaters.map(cheater => `
        <tr class="stv-table-row">
            <td class="p-3">
                <span class="stv-player-name">
                    <i class="fas fa-user-alt mr-1 text-red-500"></i> ${cheater.playerName}
                </span>
            </td>
            <td class="p-3"><code title="Steam ID: ${cheater.steamId}">${cheater.steamId}</code></td>
            <td class="p-3">
                ${cheater.steamProfile ? `<a href="${cheater.steamProfile}" target="_blank" class="stv-profile-link" title="Steam Profiline Git">Profil</a>` : 'Yok'}
            </td>
            <td class="p-3">${cheater.serverName}</td>
            <td class="p-3"><span class="stv-detection-count">${cheater.detectionCount}</span></td>
            <td class="p-3">${(cheater.cheatTypes || []).map(type => `<span class="stv-cheat-type" title="Hile Türü">${type}</span>`).join('')}</td>
            <td class="p-3">
                ${(cheater.fungunReport || '').split(',').map(link => link.trim()).filter(Boolean).map(link => 
                    `<a href="${link}" target="_blank" class="stv-report-link block" title="Fungun Raporu Gör">Rapor</a>`).join('') || 'Yok'}
            </td>
            ${isLoggedIn ? `
                <td class="p-3">
                    <div class="stv-action-buttons">
                        <button onclick="showEditModal('${cheater._id}')" class="stv-action-btn stv-edit-btn" title="Ana Kaydı Düzenle"><i class="fas fa-edit"></i></button>
                        <button onclick="deleteCheater('${cheater._id}')" class="stv-action-btn stv-delete-btn" title="Sil"><i class="fas fa-trash"></i></button>
                    </div>
                </td>
            ` : ''}
        </tr>
    `).join('');
    
    // Son güncelleme zamanını güncelle
    updateLastUpdateTime();
}

function handleSort(column) {
    if (sortColumn === column) {
        sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
        sortColumn = column;
        sortDirection = 'desc';
    }

    // Tüm başlık ikonlarını sıfırla
    document.querySelectorAll('.stv-table-header[data-sort] i').forEach(icon => {
        icon.classList.remove('fa-arrow-up', 'fa-arrow-down');
    });

    // Tıklanan başlığın ikonunu güncelle
    const headerIcon = document.querySelector(`.stv-table-header[data-sort="${column}"] i`);
    if (headerIcon) {
        headerIcon.classList.add(sortDirection === 'asc' ? 'fa-arrow-up' : 'fa-arrow-down');
    }
    
    renderCheaters();
}


// --- Hileci Ekleme/Düzenleme ---

async function handleAddCheaterSubmit(event) {
    event.preventDefault();
    const form = event.target;
    
    const data = {
        playerName: form.playerName.value,
        steamId: form.steamId.value,
        steamProfile: form.steamProfile.value,
        serverName: form.serverName.value,
        cheatTypes: form.cheatTypes.value.split(',').map(t => t.trim()).filter(Boolean),
        fungunReport: form.fungunReport.value
    };

    sendAdminAction('CHEATER_ADDED', data);
    
    form.reset();
    closeAdminPanel();
}

async function handleCheaterEditSubmit(event) {
    event.preventDefault();
    if (!editingCheater) return;
    
    const form = event.target;
    
    const updateData = {
        _id: editingCheater._id,
        playerName: form.editPlayerName.value,
        steamId: form.editSteamId.value,
        steamProfile: form.editSteamProfile.value,
        serverName: form.editServerName.value,
        detectionCount: parseInt(form.editDetectionCount.value),
        cheatTypes: form.editCheatTypes.value.split(',').map(t => t.trim()).filter(Boolean),
        fungunReport: form.editFungunReport.value
    };
    
    sendAdminAction('CHEATER_UPDATED', updateData);
    
    closeEditModal();
}

function deleteCheater(cheaterId) {
    showConfirmModal('Bu kaydı kalıcı olarak silmek istediğinizden emin misiniz?', () => {
        sendAdminAction('CHEATER_DELETED', { _id: cheaterId });
    });
}

// --- Geçmiş İşlemleri ---
function renderHistory() {
    const historyBody = document.getElementById('historyTableBody');
    if (!editingCheater || !editingCheater.history || editingCheater.history.length === 0) {
        historyBody.innerHTML = '<tr><td colspan="7" class="text-center py-3 text-gray-500">Geçmiş kaydı bulunmamaktadır.</td></tr>';
        return;
    }

    // Geçmişi en yenisi en üstte olacak şekilde ters çevir
    const reversedHistory = [...editingCheater.history].reverse();
    const isLoggedIn = !!authToken; // İşlem butonu sadece admin için

    historyBody.innerHTML = reversedHistory.map(entry => `
        <tr class="text-sm">
            <td class="p-2">${new Date(entry.date).toLocaleString()}</td>
            <td class="p-2">${entry.playerName}</td>
            <td class="p-2"><code>${entry.steamId}</code></td>
            <td class="p-2">${entry.serverName}</td>
            <td class="p-2">${(entry.cheatTypes || []).join(', ')}</td>
            <td class="p-2">${(entry.fungunReport || '').split(',').map(link => link.trim()).filter(Boolean).map(link => `<a href="${link}" target="_blank" class="text-red-400 hover:underline">Rapor</a>`).join(', ') || 'Yok'}</td>
        </tr>
    `).join('');
}


// --- Yardımcı Fonksiyonlar ---

function updateCheaterCount() {
    document.getElementById('cheaterCountDisplay').textContent = cheaters.length;
}

function updateLastUpdateTime() {
    document.getElementById('lastUpdateTime').textContent = new Date().toLocaleTimeString();
}

function showToast(message, type = 'info') {
    const toast = document.getElementById('stvToast');
    const icon = document.getElementById('toastIcon');
    const text = document.getElementById('toastText');

    // Sınıfları temizle
    toast.classList.remove('stv-toast-success', 'stv-toast-error', 'stv-toast-info');
    icon.className = '';

    // Yeni sınıfları ve içeriği ayarla
    text.textContent = message;
    
    switch (type) {
        case 'success':
            toast.classList.add('stv-toast-success');
            icon.classList.add('fas', 'fa-check-circle');
            break;
        case 'error':
            toast.classList.add('stv-toast-error');
            icon.classList.add('fas', 'fa-times-circle');
            break;
        case 'info':
        default:
            toast.classList.add('stv-toast-info');
            icon.classList.add('fas', 'fa-info-circle');
            break;
    }

    // Göster
    toast.style.display = 'flex';
    toast.classList.add('show');

    // Gizle
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => {
            toast.style.display = 'none';
        }, 300); // fade out süresi
    }, 4000);
}


// --- YENİ Bilet Sistemi Fonksiyonları ---

function renderTickets() {
    const ticketList = document.getElementById('ticketList');
    
    if (openTickets.length === 0) {
        ticketList.innerHTML = `
            <div class="p-4 text-center text-gray-500">
                Şu anda açık maç bileti bulunmamaktadır.
            </div>
        `;
        return;
    }

    ticketList.innerHTML = openTickets.map(ticket => `
        <div class="stv-ticket-card">
            <h4 class="text-lg font-bold text-red-400 mb-2">
                <i class="fas fa-flag mr-2"></i>${ticket.clanName}
            </h4>
            <div class="text-sm space-y-1">
                <p><strong>İletişim:</strong> ${ticket.contactInfo}</p>
                <p><strong>Takvim:</strong> ${ticket.schedule || 'Belirtilmemiş'}</p>
                <p><strong>Haritalar:</strong> ${(ticket.mapPreference || []).join(', ') || 'Rastgele'}</p>
                ${ticket.notes ? `<p><strong>Not:</strong> ${ticket.notes}</p>` : ''}
                <p class="text-xs text-gray-500 mt-1">Açılma: ${new Date(ticket.createdAt).toLocaleString()}</p>
            </div>
            <button 
                onclick="showAcceptTicketModal('${ticket._id}', '${ticket.clanName}')" 
                class="stv-modern-btn stv-modern-btn-success mt-3 w-full"
                title="Bu maç teklifini kabul et ve iletişime geç">
                <i class="fas fa-handshake mr-2"></i>KABUL ET
            </button>
        </div>
    `).join('');
}

async function handleTicketSubmission(event) {
    event.preventDefault();
    const form = event.target;
    const messageDisplay = document.getElementById('ticketSubmissionMessage');
    
    messageDisplay.textContent = 'Bilet gönderiliyor...';
    messageDisplay.className = 'text-yellow-400 mt-3';

    try {
        const response = await fetch(`${API_BASE_URL}/api/tickets`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                clanName: form.clanName.value,
                contactInfo: form.contactInfo.value,
                schedule: form.schedule.value,
                mapPreference: form.mapPreference.value, // Virgülle ayrılmış string olarak gönder
                notes: form.notes.value,
            })
        });

        const data = await response.json();

        if (response.ok) {
            messageDisplay.textContent = 'Bilet başarıyla açıldı! Listede görünecektir.';
            messageDisplay.className = 'text-green-500 mt-3';
            form.reset();
            // Modalı kapatmak yerine, başarılı mesajı gösterip kullanıcının görmesini sağlayabiliriz.
            setTimeout(closeTicketModal, 3000); 
        } else {
            messageDisplay.textContent = data.message || 'Bilet açılırken bir hata oluştu.';
            // Hız sınırlaması hatasını daha belirgin yap
            if (response.status === 429) {
                messageDisplay.className = 'text-red-500 font-bold mt-3';
            } else {
                messageDisplay.className = 'text-red-500 mt-3';
            }
        }
    } catch (error) {
        console.error('Bilet gönderme hatası:', error);
        messageDisplay.textContent = 'Sunucu bağlantı hatası. Lütfen daha sonra tekrar deneyin.';
        messageDisplay.className = 'text-red-500 mt-3';
    }
}

async function handleAcceptTicketSubmit(event) {
    event.preventDefault();
    if (!currentAcceptTicketId) return;

    const form = event.target;
    const messageDisplay = document.getElementById('acceptMessage');
    
    messageDisplay.textContent = 'Kabul ediliyor...';
    messageDisplay.className = 'text-yellow-400 mt-3';

    try {
        const response = await fetch(`${API_BASE_URL}/api/tickets/${currentAcceptTicketId}/accept`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                clanName: form.challengerClanName.value,
                contactInfo: form.challengerContactInfo.value
            })
        });

        const data = await response.json();

        if (response.ok) {
            messageDisplay.textContent = `Bilet başarıyla kabul edildi! ${data.clanName} klanına iletişime geçebilirsiniz. Bilet listeden kalkacaktır.`;
            messageDisplay.className = 'text-green-500 mt-3';
            form.reset();
            // Başarılı olduktan sonra modu kapat
            setTimeout(closeAcceptTicketModal, 4000); 
        } else {
            messageDisplay.textContent = data.message || 'Bilet kabul edilirken bir hata oluştu.';
            messageDisplay.className = 'text-red-500 mt-3';
        }
    } catch (error) {
        console.error('Bilet kabul etme hatası:', error);
        messageDisplay.textContent = 'Sunucu bağlantı hatası. Lütfen daha sonra tekrar deneyin.';
        messageDisplay.className = 'text-red-500 mt-3';
    }
}

// END
