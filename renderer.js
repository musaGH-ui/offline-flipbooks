import { PageFlip } from "page-flip";
import * as pdfjsLib from "pdfjs-dist";
// 1. Yeni Tauri v2 standardına göre pencere modüllerini içe aktarıyoruz
import { getCurrentWindow } from "@tauri-apps/api/window";
import { LogicalSize } from "@tauri-apps/api/window";
//import { openUrl } from '@tauri-apps/plugin-opener';

// PDF.js v4+ Modül yapısı uyumluluk köprüsü
/*if (pdfjsLib && !pdfjsLib.TextLayer) {
    pdfjsLib.TextLayer = pdfjsLib.api?.TextLayer || window.pdfjsLib?.TextLayer;
}*/

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

let pdfDoc = null;
let totalPages = null;
let pageFlipInstance = null;
const pdfUrl = `./docs/abonelik-sozlesmesinden-kaynaklanan-alacak-davalari.pdf?t=${new Date().getTime()}`;
// 2. Kullanıcının ekranda ve pencere başlığında göreceği şık Türkçe başlık
const displayTitle = "ABONELİK SÖZLEŞMESİNDEN KAYNAKLANAN ALACAK DAVALARI";

// Global arama terimi değişkeni
let currentSearchTerm = "";
const pageRenderLocks = {}; // Mükerrer render isteklerini engelleme kilidi

async function setResponsiveWindow() {
    try {
        // 1. Tauri ortamında olup olmadığımızı kontrol eden pürüzsüz kalkan
        if (typeof window === 'undefined' || !window.__TAURI_INTERNALS__) {
            console.log("Uygulama Tauri dışı bir ortamda (Electron/Tarayıcı) çalışıyor, pencere boyutlandırma atlandı.");
            return; // Tauri yoksa fonksiyonu güvenle sonlandır, hata fırlatma
        }

        // 2. Aktif pencere nesnesini çağırıyoruz (Sadece gerçek Tauri ortamında çalışır)
        const appWindow = getCurrentWindow();
        
        const screenWidth = window.screen.width;
        const screenHeight = window.screen.height;

        const newWidth = Math.round(screenWidth * 0.85); 
        const newHeight = Math.round(screenHeight * 0.85); 

        // Pencereyi yeni boyuta getir ve ortala
        await appWindow.setSize(new LogicalSize(newWidth, newHeight));
        await appWindow.center();
    } catch (err) {
        console.error("Tauri pencere ayarı yapılırken hata oluştu:", err);
    }
}

// Uygulama yüklenir yüklenmez çalıştır
//setResponsiveWindow();

// =========================================================================
// 1. UYGULAMA BAŞLANGICI VE PANEL YÖNETİMİ
// =========================================================================
window.addEventListener('DOMContentLoaded', async() => {
	// 🌟 ÖNCE pencerenin responsive olarak ekrana oturmasını KESİN olarak bekliyoruz
    try {
        // Pencerenin oturmasını kesin olarak bekliyoruz (Tek satır olarak)
        await setResponsiveWindow();
    } catch (windowError) {
        console.error("Pencere boyutlandırılırken hata:", windowError);
    }
	
	// HTML'de flipbook'un üstüne koyduğumuz başlık alanını günceller
	
	// Uygulama penceresinin üst çerçevesini de günceller
	document.title = displayTitle;
    // Tarayıcı zoom'unu bozmadan her şeyi orijinal piksellerinde (%100) bırakıyoruz
    loadPDF(pdfUrl);
    
    const btnThumbnails = document.getElementById('btn-toggle-thumbnails');
    const btnSearch = document.getElementById('btn-toggle-search');
	const btnBookmarks = document.getElementById('btn-toggle-bookmarks');
	const btnShop = document.getElementById('btn-toggle-shop'); //
	
    const sidebarThumbnails = document.getElementById('sidebar-container');
    const sidebarSearch = document.getElementById('search-sidebar-container');
    //const sidebarBookmarks = document.getElementById('bookmarks-sidebar-container');
	const sidebarBookmarks = document.getElementById('bookmarks-sidebar-container') || 
                             document.querySelector('[id*="bookmarks-sidebar"]');
	const sidebarShop = document.getElementById('shop-sidebar-container');
	// 1. Başlangıçta tüm panelleri kesin olarak gizle (Sadece sınıflar üzerinden kontrol edeceğiz)
    if (sidebarThumbnails) {
        sidebarThumbnails.classList.add('sidebar-hidden');
        sidebarThumbnails.style.setProperty('display', 'none', 'important');
    }
    if (sidebarSearch) {
        sidebarSearch.classList.add('sidebar-hidden');
        sidebarSearch.style.setProperty('display', 'none', 'important');
    }
    if (sidebarBookmarks) {
        sidebarBookmarks.classList.add('sidebar-hidden');
        sidebarBookmarks.style.setProperty('display', 'none', 'important');
    }
	
	if (sidebarShop) {
        sidebarShop.classList.add('sidebar-hidden');
        sidebarShop.style.setProperty('display', 'none', 'important');
    }

    // 2. Panelleri pürüzsüzce açıp kapatan yardımcı fonksiyon (Çakışmaları önler)
    function toggleSidebar(targetSidebar, targetButton) {
        const allSidebars = [
            { el: sidebarThumbnails, btn: btnThumbnails },
            { el: sidebarSearch, btn: btnSearch },
            { el: sidebarBookmarks, btn: btnBookmarks },
			{ el: sidebarShop, btn: btnShop }
        ];

        allSidebars.forEach(item => {
            if (!item.el) return;

            if (item.el === targetSidebar) {
				// Hedef paneli aç/kapat kontrolü (inline display değerini kontrol ediyoruz)
                const isCurrentlyHidden = item.el.style.display === 'none' || item.el.classList.contains('sidebar-hidden');
                if (isCurrentlyHidden) {
                    item.el.classList.remove('sidebar-hidden');
					item.el.style.setProperty('display', 'flex', 'important'); // CSS'i ezen mutlak güç
                    item.btn?.classList.add('active');
                    
                    // Eğer açılan panel Yer İşaretleri ise listeyi anında güncelle
                    if (item.el === sidebarBookmarks) {
                        renderBookmarksList(); 
                    }
                    // Eğer açılan panel Küçük Resimler ise aktifi senkronize et
                    if (item.el === sidebarThumbnails && pageFlipInstance) {
                        updateActiveThumbnail(pageFlipInstance.getCurrentPageIndex());
                    }
                } else {
					// Paneli gizle
                    item.el.classList.add('sidebar-hidden');
					item.el.style.setProperty('display', 'none', 'important');
                    item.btn?.classList.remove('active');
                }
            } else {
                // Diğer tüm panelleri kesin olarak kapat ve buton aktifliklerini temizle
                item.el.classList.add('sidebar-hidden');
				item.el.style.setProperty('display', 'none', 'important');
                item.btn?.classList.remove('active');
            }
        });
    }

    // 3. Tıklama Olaylarını Bağla (Hata fırlatmayan güvenli bağlantılar)
    btnThumbnails?.addEventListener('click', (e) => {
        e.preventDefault();
        toggleSidebar(sidebarThumbnails, btnThumbnails);
    });

    btnSearch?.addEventListener('click', (e) => {
        e.preventDefault();
        toggleSidebar(sidebarSearch, btnSearch);
        const searchInput = document.getElementById('txt-search-term');
        if (searchInput && !sidebarSearch.classList.contains('sidebar-hidden')) {
            setTimeout(() => searchInput.focus(), 50);
        }
    });

    btnBookmarks?.addEventListener('click', (e) => {
        e.preventDefault();
        toggleSidebar(sidebarBookmarks, btnBookmarks);
    });
	
	btnShop?.addEventListener('click', (e) => {
        e.preventDefault();
        toggleSidebar(sidebarShop, btnShop);
    });
	/********************/
	/* Katalog hazırlama*/
	/********************/
	const shopList = document.getElementById('shop-list');
	// Türkçe karakterleri ve boşlukları web uyumlu temiz bir formata (slug) çeviren yardımcı fonksiyon
    function convertToSlug(text) {
        let str = text.trim().toLowerCase();
        
        // Türkçe karakterleri standart harflere dönüştür
        const turkishChars = {
            'ç': 'c', 'ğ': 'g', 'ı': 'i', 'i': 'i', 'ö': 'o', 'ş': 's', 'ü': 'u',
            'Ç': 'c', 'Ğ': 'g', 'İ': 'i', 'Ö': 'o', 'Ş': 's', 'Ü': 'u'
        };
        
        for (let char in turkishChars) {
            str = str.replace(new RegExp(char, 'g'), turkishChars[char]);
        }
        
        return str
            .replace(/[^a-z0-9\s-]/g, '') // Harf, rakam ve boşluk dışındaki her şeyi sil
            .replace(/\s+/g, '-')         // Birden fazla peş peşe boşluğu tek bir tireye çevir
            .replace(/-+/g, '-')          // Peş peşe oluşan tireleri teke indir
            .trim();                      // Kenar boşluklarını temizle
    }
    // Mağaza verilerini txt dosyasından dinamik yükleyen ana fonksiyon
    async function loadShopItems() {
        if (!shopList) return;

        try {
            // 1. Txt dosyasını oku
            const response = await fetch('Hukuk Dava Rehberleri Magaza Linkleri.txt');
            if (!response.ok) throw new Error('Mağaza link dosyası yüklenemedi!');
            
            const textData = await response.text();
            
            // Satır satır böl ve boş satırları temizle
            const lines = textData.split('\n').map(line => line.trim()).filter(line => line.length > 0);
            
            // HTML içeriğini biriktireceğimiz değişken
            let htmlContent = '';

            lines.forEach(line => {
				if (line.startsWith('#')) {
                    return; // lines.forEach döngüsünde bu satırı es geçip bir sonrakine atlar
                }
                // 2. Parantez indekslerini bularak akıllıca parse etme
                const openParenthesisIndex = line.lastIndexOf('[');
                const closeParenthesisIndex = line.lastIndexOf(']');

				const openCurlyIndex=line.lastIndexOf('{');
				const closeCurlyIndex = line.lastIndexOf('}');
                if (openParenthesisIndex !== -1 && closeParenthesisIndex !== -1) {
                    // Eser Adı (Sol boşlukları temizlenmiş)
                    let title = line.substring(0, openParenthesisIndex).trim();
					// 🌟 KRİTİK DÜZELTME: Rakam sonlarındaki gizli ve inatçı Unicode boşluk karakterlerini temizler
                    title = title.replace(/^[\s\uFEFF\xA0]+|[\s\uFEFF\xA0]+$/g, '');
					
                    // Mağaza Linki
                    const link = line.substring(openParenthesisIndex + 1, closeParenthesisIndex).trim();
                    
                    /* 3. DOSYA ADI AKILLI GÜVENLİK FİLTRESİ (Büyük İ Harfi Onarılmış Sürüm) */
					// encodeURIComponent öncesi başlığın içindeki kararsız büyük İ harflerini 
					// garantiye almak için doğrudan URL uyumlu hex koduyla manuel değiştiriyoruz
					//let encodedTitle = title.replace(/İ/g, '%C4%B0');
					
                    //let cleanedImageName = encodeURIComponent(encodedTitle)
					//.replace(/%25C4%25B0/g, '%C4%B0') /* Çift kodlamayı (double encoding) engeller */
					//.replace(/%20/g, ' ')             /* Boşlukları %20 yerine gerçek boşluk bırakır */
					//.replace(/%C2%A0/g, '')           /* Varsa görünmez boşluk kalıntılarını temizler */
					//.replace(/%0A/g, '')              /* Satır atlama kalıntılarını temizler */
					//.replace(/%0D/g, '');             /* Satır başı kalıntılarını temizler */
					
                    //const safeImageName = encodeURIComponent(title);
                    //const imagePath = `images/${cleanedImageName}.webp`; // .png, .jpg vb. uzantınızı buraya yazın
					//let rawImageName = title.replace(/[\uFEFF\xA0\r\n]/g, '').trim();
					let rawImageName = line.substring(openCurlyIndex + 1, closeCurlyIndex).trim();
					const imagePath = `images/${rawImageName}.webp`;

                    // 4. Dinamik HTML Kartı Oluşturma
                    htmlContent += `
						<li class="shop-item">
							<img src="${imagePath}" alt="${title}" class="shop-item-cover" onerror="this.src='./images/Logo_512x800-Photoroom.png';">
							<div class="shop-item-details">
								<span class="shop-item-title">${title}</span>
								<!-- HTML içinde karmaşık kod yerine temiz link ve sınıf kullanımı -->
								<a href="${link}" class="btn-buy-now shop-inspect-btn">İncele</a>
							</div>
						</li>
					`;
                }
            });

            // 5. Hazırlanan listeyi tek seferde DOM'a enjekte et
            shopList.innerHTML = htmlContent;

        } catch (error) {
            console.error('Mağaza yüklenirken hata oluştu:', error);
            shopList.innerHTML = `<li style="color: #ff3333; padding: 15px;">Mağaza verileri yüklenemedi.</li>`;
        }
    }

    // Uygulama başladığında mağaza yükleme motorunu çalıştır
    loadShopItems();
	// 🌐 Tüm Dış Bağlantıları Açan Saf (Eklentisiz) Yardımcı
	const handleExternalLink = (targetUrl) => {
		if (!targetUrl || targetUrl === '#' || targetUrl.startsWith('javascript:')) return;

		try {
			// 1. Electron Ortamı
			if (window.require) {
				const { shell } = window.require('electron');
				shell.openExternal(targetUrl);
				return;
			}

			// 2. Tauri v2 / v1 ve Standart Tarayıcı
			// Tauri v2 varsayılan olarak _blank hedefli linkleri varsayılan sistem tarayıcısında açar
			const tempLink = document.createElement('a');
			tempLink.href = targetUrl;
			tempLink.target = '_blank';
			tempLink.rel = 'noopener noreferrer';
			document.body.appendChild(tempLink);
			tempLink.click();
			document.body.removeChild(tempLink);

		} catch (err) {
			console.warn("Dış bağlantı açılırken hata oluştu, varsayılan metoda düşülüyor:", err);
			window.open(targetUrl, '_blank');
		}
	};
	
	// 2. Logo Tıklama Dinleyicisi
	const logoLink = document.getElementById('brand-logo-link');
	if (logoLink) {
		logoLink.addEventListener('click', async (e) => {
		e.preventDefault();
		await handleExternalLink('https://dosdijitalyayincilik.com');
		});
	}
  
	// 3. Mağaza Paneli "İncele" Butonları (Dinamik Liste Yakalayıcı)
	document.body.addEventListener('click', (e) => {
    // Tıklanan eleman veya onun kapsayıcısı .btn-buy-now, .shop-inspect-btn veya .btn-inspect mi?
    const btn = e.target.closest('.btn-buy-now, .shop-inspect-btn, .btn-inspect');
    
    if (btn) {
      e.preventDefault();
      // Link değerini href attribute'undan güvenle çekiyoruz
      const destination = btn.getAttribute('href') || btn.dataset.link;
      if (destination) {
        handleExternalLink(destination);
      }
    }
  });
});//window.addEventListener('DOMContentLoaded', async() => {

// =========================================================================
// 2. PDF YÜKLEME VE KÜÇÜK RESİM SENKRONİZASYONU
// =========================================================================
async function loadPDF(url) {
    try {
        pdfDoc = await pdfjsLib.getDocument({url}).promise;
        totalPages = pdfDoc.numPages;
        document.getElementById('total-pages').innerText = totalPages;
        
        // Önce sayfaları doğal akışta kusursuzca render edip, flipbook'u ardından başlatıyoruz
        await initFlipbook();
        
        generateThumbnails(totalPages, pdfDoc);
        
    } catch (error) {
        console.error("PDF yüklenirken hata oluştu:", error);
    }
}

async function generateThumbnails(totalPages, pdfDoc) {
    const container = document.getElementById('thumbnails-list');
    if (!container) return;
    container.innerHTML = '';

    for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
        try {
            const page = await pdfDoc.getPage(pageNum);
            const pageIndex = pageNum - 1;

            const itemDiv = document.createElement('div');
            itemDiv.className = 'thumbnail-item';
            itemDiv.dataset.index = pageIndex;

            const viewport = page.getViewport({ scale: 0.32 });
            const canvas = document.createElement('canvas');
            const context = canvas.getContext('2d');
            
            itemDiv.style.width = `${Math.floor(viewport.width)}px`;
            itemDiv.style.minHeight = `${Math.floor(viewport.height)}px`;

            canvas.width = Math.floor(viewport.width);
            canvas.height = Math.floor(viewport.height);
            canvas.style.width = `${Math.floor(viewport.width)}px`;
            canvas.style.height = `${Math.floor(viewport.height)}px`;
            canvas.style.display = 'block';
            itemDiv.appendChild(canvas);

            const numSpan = document.createElement('span');
            numSpan.className = 'thumbnail-page-number';
            numSpan.textContent = pageNum;
            itemDiv.appendChild(numSpan);

            itemDiv.addEventListener('click', () => {
                if (pageFlipInstance) {
                    pageFlipInstance.turnToPage(pageIndex); // 0 Tabanlı Doğru İndeks Girişi
                    updateActiveThumbnail(pageIndex);
                }
            });
            await page.render({ canvasContext: context, viewport: viewport }).promise;
            container.appendChild(itemDiv);

        } catch (err) {
            console.error(`${pageNum}. sayfa thumbnail üretilemedi:`, err);
        }
    }
}

function updateActiveThumbnail(activeIndex) {
    document.querySelectorAll('.thumbnail-item').forEach(item => {
        item.classList.remove('active-thumbnail');
    });
    const activeItem = document.querySelector(`.thumbnail-item[data-index="${activeIndex}"]`);
    if (activeItem) {
        activeItem.classList.add('active-thumbnail');
        activeItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
}

// =========================================================================
// 3. FLIPBOOK BAŞLATMA VE ASENKRON DEFERRED YAPI
// =========================================================================
async function initFlipbook() {
    const container = document.getElementById('flipbook-container');
	const loadingScreen = document.getElementById('pdf-loading-screen');
    const loadingProgress = document.getElementById('pdf-loading-progress');
    const totalPages = pdfDoc.numPages;

    // Küçültme işini tarayıcı zoom'una değil, PDF.js render ölçeğine bırakıyoruz (1.4 ideal %80 boyutudur)
    const firstPage = await pdfDoc.getPage(1);
    const viewport = firstPage.getViewport({ scale: 1.4 }); 
    
    const pageWidth = Math.floor(viewport.width);
    const pageHeight = Math.floor(viewport.height);
	if (!container) {
        console.error("KRİTİK HATA: #flipbook-container elemanı HTML'de bulunamadı!");
        return;
    }
    console.log(`Doğal mizanpajda piksel hizalamalı render başlatıldı: ${pageWidth}x${pageHeight}`);

    // Tüm sayfaları sırayla oluşturup mizanpaj baskısı olmadan tertemiz çizdiriyoruz
    for (let i = 1; i <= totalPages; i++) {
        const pageDiv = document.createElement('div');
        pageDiv.className = 'page-container';
        pageDiv.id = `page-${i}`;
        container.appendChild(pageDiv);
		// Sayfayı render etmeyi bekle
        await renderPageLayers(i, pageDiv, pageWidth, pageHeight);
		// 🌟 CANLI İLERLEME YÜZDESİ HESAPLAMA
        if (loadingProgress) {
            const progressPercent = Math.floor((i / totalPages) * 100);
            loadingProgress.innerText = progressPercent;
        }
    }
	// 1. Ekranın o anki kullanılabilir temiz genişlik ve yüksekliğini alalım
	// Tauri/Electron pencere kenarlıklarını düşmek için %80 (0.8) ile çarpıyoruz
	const targetWidth = window.innerWidth * 0.95;
	const targetHeight = window.innerHeight * 0.85;

	// 2. Sayfanızın orijinal en-boy oranını korumak çok önemlidir.
	// Örneğin kitabınız A4 veya standart bir dikey kitap formatındaysa (En / Boy oranı genelde ~0.75'tir)
	const aspectRatio = 1.45; 

	let finalWidth = targetWidth;
	let finalHeight = targetWidth / aspectRatio;

	// Eğer hesaplanan yükseklik, ekran yüksekliğini aşıyorsa yüksekliğe göre daraltalım
	if (finalHeight > targetHeight) {
		finalHeight = targetHeight;
		finalWidth = targetHeight * aspectRatio;
	}
    // 🌟 ARTIK HARFLER %100 KUSURSUZ ÇİZİLDİ! Şimdi kütüphaneyi güvenle ayağa kaldırabiliriz.
    pageFlipInstance = new St.PageFlip(container, {
        width: Math.round(finalWidth / 2),  // Kütüphane iki sayfa açtığı için genişliği ikiye bölüyoruz
        height: Math.round(finalHeight),
        size: "fixed",
        minWidth: 200,
        minHeight: 300,
        maxWidth: 2000,
        maxHeight: 2000,
        drawShadow: true,
        showCover: true 
    });

    //pageFlipInstance.loadFromHTML(document.querySelectorAll('.page-container'));
	// 🌟 GÜVENLİ KURULUM: Elementlerin DOM'a tam oturduğundan emin oluyoruz
	const allRenderedPages = document.querySelectorAll('.page-container');
	if (allRenderedPages && allRenderedPages.length > 0) {
		pageFlipInstance.loadFromHTML(allRenderedPages);
	}
    
	// 🌟 SİHİRLİ GEÇİŞ ANI: Render ve kütüphane kurulumu bitti!
    setTimeout(() => {
        if (loadingScreen) {
            // Yükleme ekranını pürüzsüzce fade-out yaparak uçuruyoruz
            loadingScreen.style.opacity = "0";
            loadingScreen.style.transform = "scale(1.05)";
            setTimeout(() => loadingScreen.remove(), 500); // 500ms sonra DOM'dan tamamen sil
        }
        
        if (container) {
            // Flipbook'u şık bir geçiş efektiyle sahneye alıyoruz
            container.classList.add('flipbook-ready');
        }
        console.log("Tüm PDF sayfaları işlendi ve Flipbook pürüzsüzce ekrana getirildi!");
    }, 300); // Kütüphanenin loadFromHTML işlemlerini hazmetmesi için ufak bir nefes payı (300ms)
	
    // Kütüphane hazır olduğunda ve sayfa her değiştiğinde çalışacak event kurguları
    pageFlipInstance.on('init', () => {
        updateToolbarStatus(pageFlipInstance.getCurrentPageIndex() + 1);
    });

    pageFlipInstance.on('flip', (e) => {
        const currentPageIndex = e.data;
        const activePageNum = currentPageIndex + 1; 
        
        // Sayfa el ile çevrildiğinde arama yapılmışsa canlı parlatmayı anında tetikle
        if (currentSearchTerm) {
            forceHighlightDirectly(activePageNum);
            forceHighlightDirectly(activePageNum + 1);
        }

        updateToolbarStatus(activePageNum);
        updateActiveThumbnail(currentPageIndex);
    });

    const btnPrev = document.getElementById('btn-prev');
    const btnNext = document.getElementById('btn-next');
    let zoomLevel = 1;
    
    //btnNext.addEventListener('click', () => { pageFlipInstance.flipNext(); });
    //btnPrev.addEventListener('click', () => { pageFlipInstance.flipPrev(); });
    document.getElementById("btn-next").addEventListener("click", (e) => {
		e.preventDefault(); // 🌟 Zıplamayı önleyen kritik satır
		pageFlipInstance.flipNext();
	});
	document.getElementById("btn-prev").addEventListener("click", (e) => {
		e.preventDefault(); // 🌟 Zıplamayı önleyen kritik satır
		pageFlipInstance.flipPrev();
	});
	
    const flipbookContainer = document.getElementById('flipbook-container');
	const mainContentArea = document.querySelector('.main-content');
    document.getElementById('btn-zoom-in').addEventListener('click', () => {
        if (zoomLevel < 2.2) {// Göz yormayacak maksimum zoom sınırı
            zoomLevel += 0.20;// Her tıkta %20 büyüt
            flipbookContainer.style.transform = `scale(${zoomLevel})`;
            flipbookContainer.style.transformOrigin = 'center center';
			// 🌟 TARAYICIYI TETİKLEME: Kapsayıcı alana, içeriğin büyüdüğünü ve 
            // scroll-bar çıkarması gerektiğini bildirmek için margin veriyoruz
            if (zoomLevel > 1) {
                const extraSpace = (zoomLevel - 1) * 100;
                flipbookContainer.style.margin = `${extraSpace}px`;
            }
        }
    });

    document.getElementById('btn-zoom-out').addEventListener('click', () => {
        zoomLevel = Math.max(1.0, zoomLevel - 0.20);
        flipbookContainer.style.transform = `scale(${zoomLevel})`;
		if (zoomLevel === 1.0) {
            flipbookContainer.style.margin = "0px";
            if (mainContentArea) {
                mainContentArea.scrollLeft = 0;
                mainContentArea.scrollTop = 0;
            }
        } else {
            const extraSpace = (zoomLevel - 1) * 100;
            flipbookContainer.style.margin = `${extraSpace}px`;
        }
    });
    
    document.getElementById('btn-fullscreen').addEventListener('click', () => {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen();
        } else {
            document.exitFullscreen();
        }
    });

    document.getElementById('btn-print').addEventListener('click', () => { window.print(); });

    function blockFlipEvents(e) { e.stopPropagation(); }

    function updateToolbarStatus(currentPageNum) {
        const currentPageSpan = document.getElementById('current-page');
        if (currentPageSpan) currentPageSpan.innerText = currentPageNum;
        if (btnPrev) btnPrev.disabled = (currentPageNum <= 1);
        if (btnNext) btnNext.disabled = (currentPageNum >= totalPages);
    }

    // Metin Seçim Aracı Yönetimi
    document.getElementById('btn-select-text').addEventListener('click', (e) => {
        e.currentTarget.classList.toggle('active');
        const isSelectedMode = e.currentTarget.classList.contains('active');
        
        if (pageFlipInstance && pageFlipInstance.setting) {
            pageFlipInstance.setting.userPageChange = !isSelectedMode; 
            pageFlipInstance.setting.swipeDistance = isSelectedMode ? 0 : 30; 
        }
        
        const appContainer = document.getElementById('flipbook-container');
        const textLayers = document.querySelectorAll('.textLayer');
        
        if (isSelectedMode) {
            document.body.style.userSelect = 'text';
            if (appContainer) {
                appContainer.addEventListener('mousedown', blockFlipEvents, true);
                appContainer.addEventListener('mousemove', blockFlipEvents, true);
                appContainer.addEventListener('touchstart', blockFlipEvents, true);
            }
            textLayers.forEach(layer => {
                layer.style.pointerEvents = 'auto';
                layer.style.userSelect = 'text';
                layer.style.zIndex = '9999';
                layer.style.opacity = '1'; 
            });
        } else {
            window.getSelection().removeAllRanges();
            document.body.style.userSelect = 'none';
            if (appContainer) {
                appContainer.removeEventListener('mousedown', blockFlipEvents, true);
                appContainer.removeEventListener('mousemove', blockFlipEvents, true);
                appContainer.removeEventListener('touchstart', blockFlipEvents, true);
            }
            textLayers.forEach(layer => {
                layer.style.pointerEvents = 'none';
                layer.style.userSelect = 'none';
                layer.style.zIndex = ''; 
                layer.style.opacity = ''; 
            });
        }
    });
}

// =========================================================================
// 4. KATMANLARI ÇİZME (MİLİMETRİK TEXT LAYER VE HIGHLIGHT)
// =========================================================================
async function renderPageLayers(pageNum, pageDiv, width, height) {
    if (pageRenderLocks[pageNum]) return;
    pageRenderLocks[pageNum] = true;

    try {
        const page = await pdfDoc.getPage(pageNum);
        const viewport = page.getViewport({ scale: width / page.getViewport({scale: 1}).width });

        pageDiv.style.width = `${width}px`;
        pageDiv.style.height = `${height}px`;

        // Katman 1: Canvas
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        pageDiv.appendChild(canvas);
        const context = canvas.getContext('2d');
        await page.render({ canvasContext: context, viewport: viewport }).promise;

        // Katman 2: Text Layer (PDF.js Modül Uyumlu)
        const textContent = await page.getTextContent();
        const textLayerDiv = document.createElement('div');
        textLayerDiv.className = 'textLayer';
        textLayerDiv.style.width = `${width}px`;
        textLayerDiv.style.height = `${height}px`;
        textLayerDiv.style.position = 'absolute';
        textLayerDiv.style.top = '0';
        textLayerDiv.style.left = '0';
        pageDiv.appendChild(textLayerDiv);

        const textLayer = new pdfjsLib.TextLayer({
            textContentSource: textContent,
            container: textLayerDiv,
            viewport: viewport
        });
        await textLayer.render();
		// 🌟 YENİ PROJEKSİYON MOTORU: Sayfa ilk çizilirken kelime varsa sınıfla işaretle
        if (currentSearchTerm && currentSearchTerm.trim() !== "") {
            const searchRegex = new RegExp(currentSearchTerm, "i");
            const spans = textLayerDiv.querySelectorAll('span');

            spans.forEach(span => {
                if (span.textContent.match(searchRegex)) {
                    span.classList.add('pdf-live-search-match');
                }
            });
        }
        // Sayfa çizilirken halihazırda bir arama varsa, Custom Highlight API ile sıfır sapma tescille
        /*if (currentSearchTerm) {
            const searchRegex = new RegExp(currentSearchTerm, "gi");
            const spans = textLayerDiv.querySelectorAll('span');
            const highlightRanges = [];

            spans.forEach(span => {
                const textNode = span.childNodes[0];
                if (textNode && textNode.nodeType === Node.TEXT_NODE) {
                    const text = textNode.textContent;
                    let match;
                    while ((match = searchRegex.exec(text)) !== null) {
                        const range = document.createRange();
                        range.setStart(textNode, match.index);
                        range.setEnd(textNode, match.index + match[0].length);
                        highlightRanges.push(range);
                    }
                }
            });

            if (highlightRanges.length > 0 && typeof Highlight !== 'undefined') {
                const currentHighlights = CSS.highlights.get('pdf-global-search') || new Highlight();
                highlightRanges.forEach(range => currentHighlights.add(range));
                CSS.highlights.set('pdf-global-search', currentHighlights);
            }
        }*/

        // Katman 3: Annotation Layer
        const pdfLinkService = {
            baseUrl: null, pdfViewer: null, pdfHistory: null,
            goToDestination: function (dest) {
                if (!dest) return;
                const destPromise = typeof dest === 'string' ? pdfDoc.getDestination(dest) : Promise.resolve(dest);
                destPromise.then(function (resolvedDest) {
                    if (!resolvedDest) return;
                    pdfDoc.getPageIndex(resolvedDest[0]).then(function (pageIndex) {
                        if (pageFlipInstance) pageFlipInstance.turnToPage(pageIndex);
                    });
                });
            },
            navigateTo: function (dest) { this.goToDestination(dest); },
            getDestinationHash: function(dest) { return '#'; },
            getAnchorUrl: function(hash) { return '#'; },
            setViewer: function(viewer) {}, setHistory: function(history) {},
            executeNamedAction: function(action) {}, executeSetOCGState: function(action) {},
            get pagesCount() { return pdfDoc ? pdfDoc.numPages : 0; },
            get page() { return 1; }, set page(val) {},
            get rotation() { return 0; }, set rotation(val) {},
            isInPresentationMode: false, externalLinkTarget: 0,
            externalLinkRel: 'noopener noreferrer nofollow', externalLinkEnabled: true
        };

        const annotationLayerDiv = document.createElement('div');
        annotationLayerDiv.className = 'annotationLayer';
        annotationLayerDiv.style.width = `${width}px`;
        annotationLayerDiv.style.height = `${height}px`;
        annotationLayerDiv.style.position = 'absolute';
        annotationLayerDiv.style.top = '0';
        annotationLayerDiv.style.left = '0';
        pageDiv.appendChild(annotationLayerDiv);

        const annotations = await page.getAnnotations();
        const annotationLayer = new pdfjsLib.AnnotationLayer({
            div: annotationLayerDiv, accessibilityManager: null, annotationCanvasMap: null,
            page: page, viewport: viewport.clone({ dontFlip: true }), linkService: pdfLinkService
        });
        await annotationLayer.render({ annotations: annotations, linkService: pdfLinkService, imageResourcesPath: '', renderForms: false });

    } catch (renderError) {
        console.error(renderError);
    } finally {
        delete pageRenderLocks[pageNum];
    }
}

// =========================================================================
// 5. GLOBAL CUSTOM HIGHLIGHT API BOYAMA MOTORU
// =========================================================================
function forceHighlightDirectly(pageNum) {
    if (!currentSearchTerm) return;
    const flipbookContainer = document.getElementById('flipbook-container');
    if (!flipbookContainer) return;

    const pageDiv = flipbookContainer.querySelector(`#page-${pageNum}`);
    if (!pageDiv) return;

    const textLayerDiv = pageDiv.querySelector('.textLayer');
    if (!textLayerDiv) return;

    const searchRegex = new RegExp(currentSearchTerm, "i");
    const spans = textLayerDiv.querySelectorAll('span');
    //const highlightRanges = [];
	// 🌟 HTML bütünlüğünü bozmadan, tarayıcı fontuyla çakışmadan nokta atışı sınıf giydirme
    spans.forEach(span => {
        if (span.textContent.match(searchRegex)) {
            span.classList.add('pdf-live-search-match');
        } else {
            span.classList.remove('pdf-live-search-match');
        }
    });

    
    // HTML koduna (<mark>) dokunmadan doğrudan tarayıcı ekran kartından milimetrik boyatıyoruz
    /*spans.forEach(span => {
        const textNode = span.childNodes[0];
        if (textNode && textNode.nodeType === Node.TEXT_NODE) {
            const text = textNode.textContent;
            let match;
            while ((match = searchRegex.exec(text)) !== null) {
                const range = document.createRange();
                range.setStart(textNode, match.index);
                range.setEnd(textNode, match.index + match[0].length);
                highlightRanges.push(range);
            }
        }
    });*/

    /*if (highlightRanges.length > 0 && typeof Highlight !== 'undefined') {
        const currentHighlights = CSS.highlights.get('pdf-global-search') || new Highlight();
        highlightRanges.forEach(range => currentHighlights.add(range));
        CSS.highlights.set('pdf-global-search', currentHighlights);
    }*/
}

async function executeSearch() {
    const query = document.getElementById('txt-search-term').value.trim();
    const resultsList = document.getElementById('search-results-list');
    const resultsCountSpan = document.getElementById('search-results-count');
    
    // Yeni aramada eski tescilli tüm boyaları global bellekten temizle
    /*if (typeof CSS !== 'undefined' && CSS.highlights) {
        CSS.highlights.clear();
    }*/
	// 🌟 KESİN ÇÖZÜM: Yeni arama başladığında eski tüm sarı boya sınıflarını dökümandan temizle
    document.querySelectorAll('.pdf-live-search-match').forEach(el => {
        el.classList.remove('pdf-live-search-match');
    });
	
    if (resultsList) resultsList.innerHTML = "";
    if (resultsCountSpan) resultsCountSpan.textContent = "0";

    if (!query) {
        currentSearchTerm = "";
        return;
    }

    currentSearchTerm = query;
    let totalMatchCount = 0;
    const searchRegex = new RegExp(query, "gi");

    // Arka planda metin tarama ve snippet doldurma motoru (MatchAll teknolojisi)
    for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
        try {
            const page = await pdfDoc.getPage(pageNum);
            const textContent = await page.getTextContent();
            const pageText = textContent.items.map(item => item.str).join(" ");
            const matches = Array.from(pageText.matchAll(searchRegex));

            if (matches.length > 0) {
                matches.forEach(match => {
                    totalMatchCount++;
                    const matchIndex = match.index;
                    const start = Math.max(0, matchIndex - 40);
                    const end = Math.min(pageText.length, matchIndex + query.length + 40);
                    let snippet = pageText.substring(start, end);

                    if (start > 0) snippet = "..." + snippet;
                    if (end < pageText.length) snippet = snippet + "...";

                    const exactWord = match[0];
                    const highlightedSnippet = snippet.replace(
                        new RegExp(exactWord, "i"), 
                        `<mark class="search-highlight-mark">${exactWord}</mark>`
                    );

                    const li = document.createElement('li');
                    li.innerHTML = `
                        <span class="search-snippet">${highlightedSnippet}</span>
                        <span class="search-page-badge">Sayfa ${pageNum}</span>
                    `;

                    li.addEventListener('click', () => {
                        if (pageFlipInstance) {
                            pageFlipInstance.turnToPage(pageNum - 1); // 0 tabanlı doğru indeks uçuşu
                        }
                    });

                    if (resultsList) resultsList.appendChild(li);
                });
            }
        } catch (err) { console.error(err); }
    }

    if (resultsCountSpan) resultsCountSpan.textContent = totalMatchCount;

    // Arama bittiğinde ekranda o an açık olan çift sayfayı panel yapısını bozmadan havada parlatıyoruz
    if (pageFlipInstance) {
        const currentIndex = pageFlipInstance.getCurrentPageIndex();
        forceHighlightDirectly(currentIndex + 1);
        forceHighlightDirectly(currentIndex + 2);
    }
}

// =========================================================================
// 7. GÜVENLİ GLOBAL EVENT LISTENER BAĞLANTILARI
// =========================================================================
// "?.addEventListener" kullanımı, element null olsa bile uygulamanın çökmesini kesinlikle engeller.
// Yer işareti ekleme butonu
document.getElementById('btn-add-bookmark')?.addEventListener('click', addBookmark);
// Arama yapma butonu
document.getElementById('btn-do-search')?.addEventListener('click', executeSearch);
// Arama inputunda Enter tuşuna basma olayı
document.getElementById('txt-search-term')?.addEventListener('keypress', function(e) {
    if (e.key === 'Enter') executeSearch();
});

// =========================================================================
// 6. YER İŞARETLERİ (BOOKMARK) VERİ VE YÖNETİM MOTORU
// =========================================================================

// Her PDF dosyası için benzersiz bir anahtar üretir (Projedeki 300 PDF ile çakışmayı önler)
function getBookmarkStorageKey() {
    // pdfUrl değişkenindeki dosya adını çeker (Örn: "ABONELİK SÖZLEŞMESİ...")
    const fileName = pdfUrl.split('/').pop().split('?')[0];
    return `bookmarks_${fileName}`;
}

// 1. Yer İşaretlerini Listeleme Fonksiyonu
function renderBookmarksList() {
    const listContainer = document.getElementById('bookmarks-list');
    if (!listContainer) return;
    listContainer.innerHTML = "";

    const storageKey = getBookmarkStorageKey();
    const bookmarks = JSON.parse(localStorage.getItem(storageKey)) || [];

    if (bookmarks.length === 0) {
        listContainer.innerHTML = `<li style="border:none; background:none !important; justify-content:center; color: #888; font-size:14px;">Yer işareti eklenmemiş.</li>`;
        return;
    }

    // Yer işaretlerini sayfa numarasına göre sıralayarak listeliyoruz
    bookmarks.sort((a, b) => a.pageIndex - b.pageIndex);

    bookmarks.forEach(bookmark => {
        const li = document.createElement('li');
        
        li.innerHTML = `
            <span class="bookmark-text">Sayfa ${bookmark.pageIndex + 1}</span>
            <button class="btn-delete-bookmark" data-index="${bookmark.pageIndex}" title="Yer İşaretini Sil">
                <i class="fa-solid fa-trash-can"></i>
            </button>
        `;

        // Satıra tıklanınca o sayfaya uçur
        li.addEventListener('click', (e) => {
            // Eğer çöpe tıklanmadıysa sayfaya git
            if (!e.target.closest('.btn-delete-bookmark') && pageFlipInstance) {
                pageFlipInstance.turnToPage(bookmark.pageIndex);
            }
        });

        // Çöp kutusuna tıklanınca yer işaretini sil
        const btnDelete = li.querySelector('.btn-delete-bookmark');
        btnDelete.addEventListener('click', (e) => {
            e.stopPropagation(); // Satır tıklama olayını tetiklemesini engelle
            deleteBookmark(bookmark.pageIndex);
        });

        listContainer.appendChild(li);
    });
}

// 2. Yeni Yer İşareti Ekleme Fonksiyonu
function addBookmark() {
    if (!pageFlipInstance) return;
    
    const currentIndex = pageFlipInstance.getCurrentPageIndex();
    const storageKey = getBookmarkStorageKey();
    let bookmarks = JSON.parse(localStorage.getItem(storageKey)) || [];

    // Eğer bu sayfa zaten ekliyse tekrar ekleme
    const alreadyExists = bookmarks.some(b => b.pageIndex === currentIndex);
    if (alreadyExists) {
        alert("Bu sayfa zaten yer işaretlerinizde ekli!");
        return;
    }

    // Yeni bookmark nesnesi
    const newBookmark = {
        pageIndex: currentIndex,
        createdAt: new Date().toISOString()
    };

    bookmarks.push(newBookmark);
    localStorage.setItem(storageKey, JSON.stringify(bookmarks));
    
    // Listeyi güncelle ve küçük bir bildirim ver
    renderBookmarksList();
    
    // Buton ikonunu geçici olarak dolu yapıp geri çekelim (Şık bir görsel geri bildirim)
    const btnAdd = document.getElementById('btn-add-bookmark');
    if (btnAdd) {
        const icon = btnAdd.querySelector('i');
        icon.className = "fa-solid fa-bookmark";
        setTimeout(() => {
            icon.className = "fa-regular fa-bookmark";
        }, 1000);
    }
}

// 3. Yer İşareti Silme Fonksiyonu
function deleteBookmark(pageIndex) {
    const storageKey = getBookmarkStorageKey();
    let bookmarks = JSON.parse(localStorage.getItem(storageKey)) || [];
    
    bookmarks = bookmarks.filter(b => b.pageIndex !== pageIndex);
    localStorage.setItem(storageKey, JSON.stringify(bookmarks));
    
    renderBookmarksList();
}

window.addEventListener('resize', () => {
	const aspectRatio = 1.45;
    const updatedWidth = window.innerWidth * 0.95;
    const updatedHeight = window.innerHeight * 0.85;
    
    let newWidth = updatedWidth;
    let newHeight = updatedWidth / aspectRatio;
    
    if (newHeight > updatedHeight) {
        newHeight = updatedHeight;
        newWidth = updatedHeight * aspectRatio;
    }
	
	
    // 1. ÖNCE DOM ELEMENTİNİN BOYUTUNU GÜNCELLEMELİYİZ:
    // Kütüphane güncellenirken bu elementin yeni boyutlarını baz alacak
    const containerElement = document.getElementById("flipbook-container");
    if (containerElement) {
        containerElement.style.width = `${Math.round(newWidth)}px`;
        containerElement.style.height = `${Math.round(newHeight)}px`;
    }
	
	// 2. KÜTÜPHANEYİ HATASIZ BİR ŞEKİLDE YENİDEN YÜKLE VE TETİKLE
    if (pageFlipInstance) {
        const pages = document.querySelectorAll('.page-container');
        if (pages && pages.length > 0 && typeof pageFlipInstance.loadFromHTML === 'function') {
            pageFlipInstance.loadFromHTML(pages);
        }
    }
    
    
});


