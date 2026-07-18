// Kütüphaneleri HTML'de yüklediğimiz için import satırlarına gerek yok.
// Global değişkenleri doğrudan kullanıyoruz veya Electron/Tarayıcı için netleştiriyoruz.
//const pdfjsLib = window['pdfjs-dist/build/pdf'] || window.pdfjsLib;
//const PageFlip = window.St ? window.St.PageFlip : null;

/*pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();*/
// 1. pdf.min.mjs modülünü doğrudan import ediyoruz (Modül yapısına geçtik)
//import * as pdfjsLib from './js/pdf.min.mjs';
import { PageFlip } from "page-flip";
import * as pdfjsLib from "pdfjs-dist";
// 2. Bulunduğumuz konumu (renderer.js'in yerini) dinamik olarak alıyoruz
// build sonrasında app.asar içinde olsak bile bu yol doğru çözümlenir.
//const currentScriptPath = import.meta.url; 
//const workerPath = new URL('./dist/js/pdf.worker.min.mjs', currentScriptPath).toString();
// 2. BÜYÜLÜ DÜZELTME: Worker Yolunu Dinamik Çözümleme
// window.location.origin veya window.location.pathname bize uygulamanın kökünü (C:/.../index.html'in yerini) verir.
/*const getWorkerURL = () => {
    // index.html'in tam konumunu alıyoruz (ister asar içinde olsun, ister localde)
    const baseHref = window.location.href;
    
    // index.html kelimesini uçurup klasör kökünü buluyoruz
    const baseDir = baseHref.substring(0, baseHref.lastIndexOf('/'));
    
    // Geliştirme (dev) ve Production (build) ayrımına göre yolu tayin et:
    // Eğer kod dist/assets içinden çalışıyorsa, index.html bir üst klasördedir (dist/).
    // O yüzden direkt kökten dist/js klasörüne gitmesini söylüyoruz.
    if (baseDir.endsWith('/assets')) {
        // Eğer derleyici assets klasörüne attıysa, bir üst klasöre çıkıp dist/js'e bakıyoruz
        return new URL('../js/pdf.worker.min.mjs', baseDir).toString();
    } else {
        // Normal şartlarda (Dev ortamında kökteysek) direkt dist/js/ altına bakıyoruz
        return new URL('./dist/js/pdf.worker.min.mjs', baseDir).toString();
    }
};
// 3. Dinamik yolu Worker'a teslim ediyoruz
const workerTarget = getWorkerURL();
pdfjsLib.GlobalWorkerOptions.workerSrc = workerTarget;*/
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();
// PageFlip kütüphanesi global window nesnesinde olduğu için onu aynen alıyoruz
//const PageFlip = window.St ? window.St.PageFlip : null;

// ... Kodun geri kalanı (loadPDF, initFlipbook vb.) aynen kalıyor ...
let pdfDoc = null;
let totalPages=null;
let pageFlipInstance = null;
const pdfUrl = `./docs/ABONELİK SÖZLEŞMESİNDEN KAYNAKLANAN ALACAK DAVALARI_compressed.pdf?t=${new Date().getTime()}`;
// Global arama terimi değişkeni (Sayfalar render edilirken highlight kontrolü için kullanılacak)
let currentSearchTerm = "";
const pageRenderLocks = {}; // Hangi sayfanın o an render edildiğini takip eder

// Uygulama başladığında tetikle
window.addEventListener('DOMContentLoaded', () => {
	// Electron tarayıcısının zoom seviyesini kodla %90'a (0.9) çekiyoruz
    // Bu işlem senin klavyeden Zoom Out yapmanla birebir aynı etkiyi yaratır.
    if (window.next && window.next.setZoomFactor) {
         window.next.setZoomFactor(0.8);
    } else {
         // Standart web/electron zoom ayarlama yöntemi
         document.body.style.zoom = "80%"; 
    }
    loadPDF(pdfUrl);
	
	// Elementleri yakalıyoruz
    const btnThumbnails = document.getElementById('btn-toggle-thumbnails');
    const btnSearch = document.getElementById('btn-toggle-search');
    const sidebarThumbnails = document.getElementById('sidebar-container');
    const sidebarSearch = document.getElementById('search-sidebar-container');

    console.log("Element Kontrolü:", { btnThumbnails, btnSearch, sidebarThumbnails, sidebarSearch });

    // --- Başlangıç Ayarı: Sayfa ilk açıldığında iki paneli de kesin olarak kapatıyoruz ---
    if (sidebarThumbnails) {
        sidebarThumbnails.classList.add('sidebar-hidden');
        sidebarThumbnails.style.setProperty('display', 'none', 'important');
    }
    if (sidebarSearch) {
        sidebarSearch.classList.add('sidebar-hidden');
        sidebarSearch.style.setProperty('display', 'none', 'important');
    }

    
    // --- 1. SAYFALAR BUTONU TIKLANMA AKSİYONU (KESİN ÇÖZÜM) ---
    if (btnThumbnails && sidebarThumbnails) {
        btnThumbnails.addEventListener('click', function(e) {
            e.preventDefault();
            console.log("Sayfalar butonuna tıklandı!");

            // 1. Önce Arama panelini kesin olarak kapat ve söndür
            if (sidebarSearch) {
                sidebarSearch.classList.add('sidebar-hidden');
                sidebarSearch.style.setProperty('display', 'none', 'important');
            }
            if (btnSearch) {
                btnSearch.classList.remove('active');
            }
            
            // 2. KRİTİK DÜZELTME: Sınıfa değil, elementin gerçek CSS display durumuna bakıyoruz
            const isClosed = sidebarThumbnails.style.display === 'none' || sidebarThumbnails.classList.contains('sidebar-hidden');

            if (isClosed) {
                // PANELİ AÇ
                sidebarThumbnails.classList.remove('sidebar-hidden');
                sidebarThumbnails.style.setProperty('display', 'flex', 'important');
                btnThumbnails.classList.add('active');
                
                // Artık bu log kesinlikle çalışacak ve konsola düşecek!
                console.log("sidebarThumbnails paneli başarıyla açıldı!");
                
                // 3. Küçük resim senkronizasyonu
                try {
                    if (typeof pageFlipInstance !== 'undefined' && pageFlipInstance) {
                        let currentIndex = 0;
                        if (typeof pageFlipInstance.getCurrentPageIndex === 'function') {
                            currentIndex = pageFlipInstance.getCurrentPageIndex();
                        }
                        if (typeof updateActiveThumbnail === 'function') {
                            updateActiveThumbnail(currentIndex);
                        }
                    }
                } catch (flipContainerError) {
                    console.warn("PageFlip indeks senkronizasyonu pas geçildi:", flipContainerError);
                }

            } else {
                // PANELİ KAPAT
                sidebarThumbnails.classList.add('sidebar-hidden');
                sidebarThumbnails.style.setProperty('display', 'none', 'important');
                btnThumbnails.classList.remove('active');
                console.log("sidebarThumbnails paneli kapatıldı!");
            }
        });
    }

    // --- 2. TERİM ARA BUTONU TIKLANMA AKSİYONU ---
    if (btnSearch && sidebarSearch) {
        btnSearch.addEventListener('click', function(e) {
            e.preventDefault();
            console.log("Terim Ara butonuna tıklandı!");

            // Önce Sayfalar panelini kesin olarak kapat ve söndür
            if (sidebarThumbnails) {
                sidebarThumbnails.classList.add('sidebar-hidden');
                sidebarThumbnails.style.setProperty('display', 'none', 'important');
            }
            if (btnThumbnails) btnThumbnails.classList.remove('active');
            
            // Şimdi Arama panelini aç/kapat
            if (sidebarSearch.classList.contains('sidebar-hidden')) {
                // PANELİ AÇ
                sidebarSearch.classList.remove('sidebar-hidden');
                sidebarSearch.style.setProperty('display', 'flex', 'important');
                btnSearch.classList.add('active');
                
                // Input alanına odaklan
                const searchInput = document.getElementById('txt-search-term');
                if (searchInput) setTimeout(() => searchInput.focus(), 50);
            } else {
                // PANELİ KAPAT
                sidebarSearch.classList.add('sidebar-hidden');
                sidebarSearch.style.setProperty('display', 'none', 'important');
                btnSearch.classList.remove('active');
            }
        });
    }
});

// 2. PDF Dosyasını Yükleme Fonksiyonu
async function loadPDF(url) {
    try {
        pdfDoc = await pdfjsLib.getDocument({url}).promise;
		totalPages = pdfDoc.numPages;
		document.getElementById('total-pages').innerText = totalPages;
        console.log(`PDF Başarıyla Yüklendi. Toplam Sayfa: ${pdfDoc.numPages}`);
        
        // İçindekileri oluştur **GEREK KALMADI**
        //await buildTableOfContents();
		// Flipbook Sayfalarını Oluştur ve Başlat
        await initFlipbook();
		// Arka planda küçük resimleri oluşturmaya başla
		if (pageFlipInstance) {
            pageFlipInstance.on('flip', (e) => {
                const currentPageIndex = e.data; // page-flip o anki sayfa indeksini verir
                
                // Eğer sayfa numarası 1 tabanlı güncelleniyorsa pageIndex + 1 yapın
                if (typeof updateToolbarStatus === 'function') {
                    updateToolbarStatus(currentPageIndex + 1); 
                }
                
                // Küçük resim panelindeki seçimi de otomatik kaydır ve güncelle
                updateActiveThumbnail(currentPageIndex);
            });
        }
		generateThumbnails(totalPages,pdfDoc);
		
    } catch (error) {
        console.error("PDF yüklenirken hata oluştu:", error);
    }
}
// 1. Butona Tıklayınca Sol Paneli Açma / Kapatma Mekanizması
document.getElementById('btn-toggle-thumbnails').addEventListener('click', function(e) {
    e.currentTarget.classList.toggle('active');
    const sidebar = document.getElementById('sidebar-container');
    sidebar.classList.toggle('sidebar-hidden');
    
    // Panel açıldığında o anki aktif sayfayı küçük resimlerde de odakla
    if (!sidebar.classList.contains('sidebar-hidden') && pageFlipInstance) {
        // Eğer page-flip indeks mantığınız 0 tabanlıysa pageFlip.getCurrentPageIndex() kullanın
        const currentIndex = pageFlipInstance.getCurrentPageIndex ? pageFlipInstance.getCurrentPageIndex() : 0;
        updateActiveThumbnail(currentIndex);
    }
});

// 2. PDF Yüklendiğinde Tetiklenecek Thumbnail Üretim Fonksiyonu
async function generateThumbnails(totalPages,pdfDoc) {
    const container = document.getElementById('thumbnails-list');
    if (!container) return;
    container.innerHTML = ''; // Temizlik

    // PDF'teki tüm sayfaları sırayla dönüyoruz
    for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
        try {
            const page = await pdfDoc.getPage(pageNum);
            const pageIndex = pageNum - 1; // 0 tabanlı indeks

            // Resim kutusunun HTML iskeleti
            const itemDiv = document.createElement('div');
            itemDiv.className = 'thumbnail-item';
            itemDiv.dataset.index = pageIndex; // Hızlı erişim için indeksi sakla

            // Küçük resim için canvas oluşturma (Ölçek 0.18 çok hızlı render olur ve hafızayı yormaz)
			const viewport = page.getViewport({ scale: 0.32 });
            const canvas = document.createElement('canvas');
            const context = canvas.getContext('2d');
            // DÜZELTME: Kapsayıcı div'in ezilmesini önlemek için min-width ve min-height zorluyoruz
			itemDiv.style.width = `${Math.floor(viewport.width)}px`;
			itemDiv.style.minHeight = `${Math.floor(viewport.height)}px`; // height yerine minHeight

            // Canvas çizim alanı boyutları (Piksel olarak)
			canvas.width = Math.floor(viewport.width);
			canvas.height = Math.floor(viewport.height);
			// 2. KRİTİK DÜZELTME: Çizgi şeklinde kalmaması için CSS boyutlarını zorla tanımlıyoruz
            // Canvas görsel boyutları (CSS olarak zorlama)
			canvas.style.width = `${Math.floor(viewport.width)}px`;
			canvas.style.height = `${Math.floor(viewport.height)}px`;
			canvas.style.display = 'block';
            itemDiv.appendChild(canvas);

            // Sayfa Numarası Baloncuğu
            const numSpan = document.createElement('span');
            numSpan.className = 'thumbnail-page-number';
            numSpan.textContent = pageNum;
            itemDiv.appendChild(numSpan);

            // TIKLAMA OLAYI: Küçük resme tıklandığında flipbook o sayfaya dönecek
            itemDiv.addEventListener('click', () => {
                if (pageFlipInstance) {
                    // page-flip kütüphanenizin turnToPage fonksiyonunun indeks mi 
                    // yoksa normal insan sayfa sayısı mı beklediğine göre ayarlayın.
                    // Üstteki aşamalarda 0 tabanlı indeks ile çözmüştük, o yüzden pageIndex gönderiyoruz.
                    pageFlipInstance.turnToPage(pageIndex); 
                    updateActiveThumbnail(pageIndex);
                    
                    if (typeof updateToolbarStatus === 'function') {
                        updateToolbarStatus(pageNum);
                    }
                }
            });
			// ÖNCE çizdiriyoruz, render bitince DOM'a basıyoruz (Görsel kararlılık için)
            await page.render({ canvasContext: context, viewport: viewport }).promise;
            container.appendChild(itemDiv);

            // Arka planda asenkron olarak küçük resmi çizdiriyoruz (Kullanıcı arayüzünü kilitlemez)
            //await page.render({ canvasContext: context, viewport: viewport }).promise;

        } catch (err) {
            console.error(`${pageNum}. sayfa thumbnail üretilemedi:`, err);
        }
    }
}

// 3. Kitapta Sayfa Değiştikçe Küçük Resimlerdeki Mavi Çerçeveyi Güncelleyen Yardımcı Fonksiyon
function updateActiveThumbnail(activeIndex) {
    // Önceki tüm aktif sınıflarını temizle
    document.querySelectorAll('.thumbnail-item').forEach(item => {
        item.classList.remove('active-thumbnail');
    });

    // O anki aktif sayfanın thumbnail kutusunu bul ve seçili yap
    const activeItem = document.querySelector(`.thumbnail-item[data-index="${activeIndex}"]`);
    if (activeItem) {
        activeItem.classList.add('active-thumbnail');
        
        // Küçük resim listesi uzunsa, aktif olan resme otomatik olarak scroll yap (kaydır)
        activeItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
}


// 3. İçindekiler Tablosunu (Outline) Çekme ve Ekrana Basma **GEREK KALMADI**
/*async function buildTableOfContents() {
    //const outline = await pdfDoc.getOutline();
    const outlineList = document.getElementById('toc-list');
    if (!outlineList) return;
	// PDF.js içinden yerleşik içindekiler ağacını çekiyoruz
    pdfDoc.getOutline().then(function(outline) {
		if (!outline || outline.length === 0) {
			outlineList.innerHTML = '<li>İçindekiler tablosu bulunamadı.</li>';
			return;
		}
		outlineList.innerHTML = ''; // Temizlik
    
		// Başlıkları HTML listesine dönüştüren döngü
        outline.forEach(function(item) {
            const li = document.createElement('li');
            const a = document.createElement('a');
            a.textContent = item.title;
            a.href = '#';
            
            // Başlığın tıkladığında hangi sayfaya gideceğini PDF.js dest (destination) objesinden bulacağız
            a.addEventListener('click', function(e) {
                e.preventDefault();
                
                if (item.dest) {
                    // PDF.js sayfa hedefini çözümlüyor
                    pdfDoc.getPageIndex(item.dest[0]).then(function(pageIndex) {
                        const targetPageNum = pageIndex + 1; // 0 tabanlı indeksi sayfa numarasına çevir
                        
                        // page-flip kütüphanesine o sayfaya gitmesi emrini veriyoruz
                        if (pageFlipInstance) {
                            pageFlipInstance.turnToPage(targetPageNum); 
                            
                            // Toolbar'ı da el ile haberdar edelim (garanti olması için)
                            if (typeof updateToolbarStatus === 'function') {
                                updateToolbarStatus(targetPageNum);
                            }
                        }
                    }).catch(err => console.error("Sayfa indeksi bulunamadı:", err));
                }
            });

            li.appendChild(a);
            outlineList.appendChild(li);

            // Eğer alt başlıklar (sub-items) varsa onları da hiyerarşik ekleyebiliriz
            if (item.items && item.items.length > 0) {
                const subList = document.createElement('ul');
                item.items.forEach(function(subItem) {
                    const subLi = document.createElement('li');
                    const subA = document.createElement('a');
                    subA.textContent = subItem.title;
                    subA.href = '#';
                    subA.addEventListener('click', function(e) {
                        e.preventDefault();
                        pdfDoc.getPageIndex(subItem.dest[0]).then(function(subPageIndex) {
                            pageFlip.turnToPage(subPageIndex + 1);
                        });
                    });
                    subLi.appendChild(subA);
                    subList.appendChild(subLi);
                });
                li.appendChild(subList);
            }
        });
    }).catch(function(error) {
        console.error("İçindekiler tablosu alınırken hata:", error);
        outlineList.innerHTML = '<li>İçindekiler yüklenirken bir hata oluştu.</li>';
    });
}*/ //GEREK KALMADI

// Dest yapısından sayfa numarasını bulan yardımcı fonksiyon
async function getPageIndexFromDest(dest) {
    if (typeof dest === 'string') {
        const pageRef = await pdfDoc.getDestination(dest);
        return await pdfDoc.getPageIndex(pageRef[0]);
    } else if (Array.isArray(dest)) {
        return await pdfDoc.getPageIndex(dest[0]);
    }
    return null;
}

// 4. Flipbook Yapısını Kurma ve Sayfaları Render Etme
async function initFlipbook() {
    const container = document.getElementById('flipbook-container');
    const totalPages = pdfDoc.numPages;

    // İlk sayfanın boyutunu baz alarak flipbook boyutlarını belirliyoruz
    //const firstPage = await pdfDoc.getPage(1);
    //const viewport = firstPage.getViewport({ scale: 1.5 }); // Netlik için 1.5 ya da 2 idealdir
    
    // Genişlik çift sayfa yan yana olacağı için (Tek sayfa genişliği * 2) olacak şekilde kurgulanacak
    //const pageWidth = Math.floor(viewport.width);
    //const pageHeight = Math.floor(viewport.height);
	// 1. İlk sayfanın ham (orijinal) boyutunu scale: 1 iken alıyoruz
    const firstPage = await pdfDoc.getPage(1);
	const viewport = firstPage.getViewport({ scale: 1.8 }); 
    
    const pageWidth = Math.floor(viewport.width);
    const pageHeight = Math.floor(viewport.height);

    console.log(`Flipbook yüksek çözünürlük boyutu tanımlandı: ${pageWidth}x${pageHeight}`);
    
    // Tüm sayfaları döngüyle DOM'a ekle
    for (let i = 1; i <= totalPages; i++) {
        const pageDiv = document.createElement('div');
        pageDiv.className = 'page-container'; // CSS'teki class
	pageDiv.id = `page-${i}`;
        container.appendChild(pageDiv);

        // Sayfa katmanlarını çiz (Canvas + Text Layer)
        await renderPageLayers(i, pageDiv, pageWidth, pageHeight);
    }

    // `page-flip` kütüphanesini ayağa kaldır
    pageFlipInstance = new St.PageFlip(container, {
        width: pageWidth,
        height: pageHeight,
        size: "fixed",
        minWidth: pageWidth,
        minHeight: pageHeight,
        maxWidth: pageWidth,
        maxHeight: pageHeight,
        drawShadow: true,
        showCover: true // İlk sayfa kapak olsun (Tek görünür)
    });
	// DOM elemanlarından flipbook'u yükle
    pageFlipInstance.loadFromHTML(document.querySelectorAll('.page-container'));
	
	// --- TOOLBAR ENTEGRASYONU ---

	const currentPageSpan = document.getElementById('current-page');
	const totalPagesSpan = document.getElementById('total-pages');
	const btnPrev = document.getElementById('btn-prev');
	const btnNext = document.getElementById('btn-next');
	const bookmarkBtn = document.getElementById('btn-bookmark').querySelector('i');

	let zoomLevel = 1;
	
	/**
	 * 1. page-flip Kütüphanesi Hazır Olduğunda Dinamik Değerleri Atama
	 */
	pageFlipInstance.on('init', () => {
		// Toplam sayfa sayısını page-flip'ten dinamik alıyoruz
		const total = pageFlipInstance.getPageCount();
		totalPagesSpan.innerText = total;
		
		// İlk sayfa kontrolü
		updateToolbarStatus(pageFlipInstance.getCurrentPageIndex());
	});
	
	/**
	 * 2. Kullanıcı Sayfayı El ile Çevirdiğinde Toolbar'ı Güncelleme
	 * 'flip' event'i sayfa çevrilme işlemi bittiğinde tetiklenir.
	 */
	pageFlipInstance.on('flip', (e) => {
		// e.data aktif sayfa indeksini verir (0 tabanlıdır, bu yüzden +1 veya kütüphane moduna göre +2 olabilir)
		// page-flip çift sayfa (spread) gösteriyorsa, görünür ilk sayfanın indeksini almak en doğrusudur:
		const activePageIndex = pageFlipInstance.getCurrentPageIndex() + 1; 
		
		updateToolbarStatus(activePageIndex);
	});
	
	/**
	 * 3. Toolbar Elemanlarını Güncelleyen Ortak Fonksiyon
	 */
	function updateToolbarStatus(currentPageNum) {
		currentPageSpan.innerText = currentPageNum;
		const total = pageFlipInstance.getPageCount();

		// Buton kilitlerini sayfa konumuna göre dinamik yönetme
		btnPrev.disabled = (currentPageNum <= 1);
		btnNext.disabled = (currentPageNum >= total);

		// Bookmark durumunu kontrol et
		if (localStorage.getItem(`bookmark_page_${currentPageNum}`)) {
			bookmarkBtn.classList.replace('far', 'fas');
		} else {
			bookmarkBtn.classList.replace('fas', 'far');
		}
	}
	
	/**
	 * 4. Önceki / Sonraki Buton Tıklamaları
	 */
	btnNext.addEventListener('click', () => {
		// page-flip kütüphanesinin kendi güvenli sonraki sayfa metodu
		pageFlipInstance.flipNext(); 
	});

	btnPrev.addEventListener('click', () => {
		// page-flip kütüphanesinin kendi güvenli önceki sayfa metodu
		pageFlipInstance.flipPrev(); 
	});
	
	/**
	 * 5. Büyüt / Küçült (Zoom) İşlevi
	 * page-flip kütüphanesinde canvas tasarımları etkilendiği için zoom işlemini 
	 * tüm '#flipbook-container' elementine CSS transform uygulayarak çözüyoruz.
	 */
	const flipbookContainer = document.getElementById('flipbook-container');

	document.getElementById('btn-zoom-in').addEventListener('click', () => {
		if (zoomLevel < 2.5) { // Maksimum zoom sınırı
			zoomLevel += 0.15;
			flipbookContainer.style.transform = `scale(${zoomLevel})`;
			flipbookContainer.style.transformOrigin = 'center center';
		}
	});

	document.getElementById('btn-zoom-out').addEventListener('click', () => {
		//if (zoomLevel > 0.6) {
			zoomLevel= Math.max(1.0, zoomLevel - 0.15);
			flipbookContainer.style.transform = `scale(${zoomLevel})`;
		//}
	});
	
	/**
	 * 6. Bookmark (Yer İmi) İşlevi
	 */
	document.getElementById('btn-bookmark').addEventListener('click', () => {
		const activePage = pageFlip.getCurrentPageIndex() + 1;
		const bookmarkKey = `bookmark_page_${activePage}`;
		
		if (localStorage.getItem(bookmarkKey)) {
			localStorage.removeItem(bookmarkKey);
			bookmarkBtn.classList.replace('fas', 'far');
		} else {
			localStorage.setItem(bookmarkKey, 'true');
			bookmarkBtn.classList.replace('far', 'fas');
		}
	});
	
	/**
	 * 7. Tam Ekran, Yazdır ve Metin Seçimi (Önceki Tasarıma Sadık)
	 */
	document.getElementById('btn-fullscreen').addEventListener('click', () => {
		if (!document.fullscreenElement) {
			document.documentElement.requestFullscreen();
		} else {
			document.exitFullscreen();
		}
	});

	document.getElementById('btn-print').addEventListener('click', () => {
		window.print();
	});
	// Olayları durdurmak için kullanacağımız engelleyici fonksiyon
	function blockFlipEvents(e) {
		// Metin seçerken page-flip'in fare hareketlerini yakalamasını engeller
		e.stopPropagation(); 
	}
	// Metin seçimi modu (Eğer metin katmanı -textLayer- kullandıysak açıp kapatır)
	document.getElementById('btn-select-text').addEventListener('click', (e) => {
		e.currentTarget.classList.toggle('active');
		const isSelectedMode = e.currentTarget.classList.contains('active');
		
		// 1. Kütüphanenin İç Ayarlarını (updateFromHtml KULLANMADAN) Kapatıp Açma
		if (pageFlipInstance && pageFlipInstance.setting) {
			// Sayfa çevirme izinlerini doğrudan nesne içinden değiştiriyoruz
			pageFlipInstance.setting.userPageChange = !isSelectedMode; 
			
			// Sürükleme mesafesini manipüle ederek fareyle sayfa çekmeyi donduruyoruz
			pageFlipInstance.setting.swipeDistance = isSelectedMode ? 0 : 30; 
		}
		
		// 2. Projedeki tüm text katmanlarını ve kütüphanenin kendi oluşturduğu sayfa elementlerini bulalım
		const appContainer = document.getElementById('flipbook-container') || document.querySelector('.stPageFlip');
		const textLayers = document.querySelectorAll('.textLayer');
		// page-flip kütüphanesinin sarmaladığı tüm sayfa container'larını seçiyoruz (.stpageflip-... sınıfları gibi)
		// Eğer kütüphane sayfalara özel bir sınıf atadıysa onu hedefliyoruz, garanti olması için canvas'ların üst elementlerine de bakıyoruz.
		const pageElements = document.querySelectorAll('.stPageFlip-page, .page-content, .page');
		
		if (isSelectedMode) {
			// Metin seçme modu AÇIK
			document.body.style.userSelect = 'text';
			
			if (appContainer) {
				appContainer.addEventListener('mousedown', blockFlipEvents, true);
				appContainer.addEventListener('mousemove', blockFlipEvents, true);
				appContainer.addEventListener('touchstart', blockFlipEvents, true);
				appContainer.style.pointerEvents = 'auto';
			}
			textLayers.forEach(layer => {
				layer.style.pointerEvents = 'auto';
				layer.style.userSelect = 'text';
				layer.style.webkitUserSelect = 'text';
				layer.style.msUserSelect = 'text';
				layer.style.zIndex = '9999'; // Canvas çiziminin kesinlikle önüne geçmeli
				layer.style.opacity = '1'; 
				layer.style.mixBlendMode = 'normal';
			});
		} else {
			// Metin seçme modu KAPALI (Normal Kitap Modu)
			window.getSelection().removeAllRanges(); // Seçili kalan metinleri temizle
			document.body.style.userSelect = 'none';
			
			// Engelleyici event listener'ları kaldır, kitap normal çalışsın
			if (appContainer) {
				appContainer.removeEventListener('mousedown', blockFlipEvents, true);
				appContainer.removeEventListener('mousemove', blockFlipEvents, true);
				appContainer.removeEventListener('touchstart', blockFlipEvents, true);
			}

			textLayers.forEach(layer => {
				layer.style.pointerEvents = 'none';
				layer.style.userSelect = 'none';
				layer.style.webkitUserSelect = 'none';
				layer.style.msUserSelect = 'none';
				layer.style.zIndex = ''; 
				layer.style.opacity = ''; 
				layer.style.mixBlendMode = '';
			});
		}
	});
}

// 5. Her Sayfa İçin Canvas ve Gerçek Metin (Text Layer) Oluşturma
// --- 2. ADIM: renderPageLayers fonksiyonunu bu korumalı versiyonla güncelleyin ---
async function renderPageLayers(pageNum, pageDiv, width, height) {
    // 🔒 RUSH CONDITION KORUMASI: Eğer bu sayfa şu an zaten render ediliyorsa, yeni isteği iptal et
    if (pageRenderLocks[pageNum]) {
        console.warn(`${pageNum}. sayfa şu an render ediliyor, mükerrer istek engellendi.`);
        return;
    }
    // Sayfayı kilitle
    pageRenderLocks[pageNum] = true;

    try {
        const page = await pdfDoc.getPage(pageNum);
        
        // Temel viewport hesaplama
        const viewport = page.getViewport({ scale: width / page.getViewport({scale: 1}).width });

        pageDiv.style.width = `${width}px`;
        pageDiv.style.height = `${height}px`;

        // =========================================================================
        // KATMAN 1: Canvas (Arka Plan)
        // =========================================================================
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        pageDiv.appendChild(canvas);
        const context = canvas.getContext('2d');
        await page.render({ canvasContext: context, viewport: viewport }).promise;

        // =========================================================================
        // KATMAN 2: Text Layer (RESMİ ARAMA DESTEKLİ)
        // =========================================================================
        const textContent = await page.getTextContent();
        const textLayerDiv = document.createElement('div');
        textLayerDiv.className = 'textLayer';
        textLayerDiv.style.width = `${width}px`;
        textLayerDiv.style.height = `${height}px`;
        textLayerDiv.style.position = 'absolute';
        textLayerDiv.style.top = '0';
        textLayerDiv.style.left = '0';
        pageDiv.appendChild(textLayerDiv);

        // 🌟 RESMİ ÇÖZÜM: PDF.js'e kelime parçalanmalarını birleştirmesini söylüyoruz
        const textLayer = new pdfjsLib.TextLayer({
            textContentSource: textContent,
            container: textLayerDiv,
            viewport: viewport,
            page: page
        });

        // Metin katmanını render ediyoruz
        await textLayer.render();

        // 🌟 ESKİ TÜM RANGE/CUSTOM HIGHLIGHT KODLARINI ÇÖPE ATTIK!
        // PDF.js'in kendi resmi parlatma sınıflarını tetiklemek için bu hafif döngüyü yazıyoruz:
        if (typeof currentSearchTerm !== 'undefined' && currentSearchTerm && currentSearchTerm.trim() !== "") {
            const searchRegex = new RegExp(`(${currentSearchTerm})`, "gi");
            const spans = textLayerDiv.querySelectorAll('span');
            
            spans.forEach(span => {
                if (span.textContent.match(searchRegex)) {
                    // Parçalanmış kelimeleri PDF.js mimarisinde sıfır sapmayla boyayan resmi sınıf
                    span.innerHTML = span.textContent.replace(
                        searchRegex, 
                        `<mark class="pdf-official-match">$1</mark>`
                    );
                }
            });
        }

        // =========================================================================
        // KATMAN 3: Annotation Layer (İçindekiler ve Tıklanabilir Link Katmanı)
        // =========================================================================
        
        // PDF.js v4.x+ ile %100 uyumlu güncellenmiş link servis nesnesi
        const pdfLinkService = {
            baseUrl: null,
            pdfViewer: null,
            pdfHistory: null,
            
            goToDestination: function (dest) {
                if (!dest) return;
                const destPromise = typeof dest === 'string' 
                    ? pdfDoc.getDestination(dest) 
                    : Promise.resolve(dest);

                destPromise.then(function (resolvedDest) {
                    if (!resolvedDest) return;
                    pdfDoc.getPageIndex(resolvedDest[0]).then(function (pageIndex) {
                        const targetPageNum = pageIndex + 1;
                        console.log("Kütüphane Tetiklendi -> Sayfa:", targetPageNum);
                        if (typeof pageFlipInstance !== 'undefined' && pageFlipInstance) {
                            pageFlipInstance.turnToPage(targetPageNum);
                            if (typeof updateToolbarStatus === 'function') {
                                updateToolbarStatus(targetPageNum);
                            }
                        }
                    }).catch(err => console.error("Sayfa indeksi hesaplanamadı:", err));
                }).catch(err => console.error("Link hedefi çözümlenemedi:", err));
            },
            navigateTo: function (dest) {
                this.goToDestination(dest);
            },
            getDestinationHash: function(dest) { return '#'; },
            getAnchorUrl: function(hash) { return '#'; },
            setViewer: function(viewer) {},
            setHistory: function(history) {},
            executeNamedAction: function(action) {},
            executeSetOCGState: function(action) {},
            get pagesCount() { return pdfDoc ? pdfDoc.numPages : 0; },
            get page() { return 1; },
            set page(val) {},
            get rotation() { return 0; },
            set rotation(val) {},
            isInPresentationMode: false,
            externalLinkTarget: 0,
            externalLinkRel: 'noopener noreferrer nofollow',
            externalLinkEnabled: true
        };

        // 1. Katman DIV elementini oluşturuyoruz
        const annotationLayerDiv = document.createElement('div');
        annotationLayerDiv.className = 'annotationLayer';
        annotationLayerDiv.style.width = `${width}px`;
        annotationLayerDiv.style.height = `${height}px`;
        annotationLayerDiv.style.position = 'absolute';
        annotationLayerDiv.style.top = '0';
        annotationLayerDiv.style.left = '0';
        pageDiv.appendChild(annotationLayerDiv);

        // 2. Sayfadaki yerleşik link verilerini çekiyoruz (Artık try bloğu içinde olduğu için "page" tanımlı!)
        const annotations = await page.getAnnotations();

        // 3. AnnotationLayer instance oluşturma
        const annotationLayer = new pdfjsLib.AnnotationLayer({
            div: annotationLayerDiv,
            accessibilityManager: null,
            annotationCanvasMap: null,
            page: page,
            viewport: viewport.clone({ dontFlip: true }),
            linkService: pdfLinkService
        });
        
        // 4. Asenkron render görevi
        await annotationLayer.render({
            annotations: annotations,
            linkService: pdfLinkService,
            imageResourcesPath: '',
            renderForms: false
        });

    } catch (renderError) {
        console.error(`${pageNum}. sayfa katmanları çizilirken hata oluştu:`, renderError);
    } finally {
        // 🔓 Tüm katmanlar (Canvas, Text, Annotation) başarıyla çizildikten 
        // veya bir hata fırlatıldıktan sonra kilidi güvenle kaldırıyoruz.
        delete pageRenderLocks[pageNum];
    }
}

// =========================================================================
// 2. SABİT DOM OLAY DİNLEYİCİLERİ (Dosyanın En Altında, Global Alanda Kalmalı)
// =========================================================================

// Uygulama ilk açıldığında bir kez çalışırlar, mükerrer tetiklenme riskini sıfırlarlar
document.getElementById('btn-do-search').addEventListener('click', executeSearch);

document.getElementById('txt-search-term').addEventListener('keypress', function(e) {
    if (e.key === 'Enter') executeSearch();
});

/*async function executeSearch() {
    const query = document.getElementById('txt-search-term').value.trim();
    const listContainer = document.getElementById('search-results-list');
    const countSpan = document.getElementById('search-results-count');
    
    if (!query) return;
    
    currentSearchTerm = query; // Arama terimini hafızaya al
    listContainer.innerHTML = '<li>Aranıyor...</li>';
    let resultsCount = 0;
    listContainer.innerHTML = ''; // Temizle

    // Tüm sayfaları arka planda hızlıca tarıyoruz (Görsel render yapmadan sadece metin okuyoruz)
    for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
        try {
            const page = await pdfDoc.getPage(pageNum);
            const textContent = await page.getTextContent();
            
            // Sayfadaki tüm metin parçalarını birleştiriyoruz
            const pageText = textContent.items.map(item => item.str).join(" ");
            
            // Küçük-büyük harf duyarlılığını ortadan kaldırarak arama yapıyoruz
            const queryRegex = new RegExp(`(${query})`, "gi");
            
            if (pageText.match(queryRegex)) {
                // Kelimenin geçtiği indexleri bulup 5-6 kelimelik öbekler çıkarıyoruz
                const words = pageText.split(/\s+/);
                
                words.forEach((word, index) => {
                    if (word.toLowerCase().includes(query.toLowerCase())) {
                        resultsCount++;
                        
                        // Kelimenin 3 kelime öncesini ve 3 kelime sonrasını alarak 6-7 kelimelik öbek oluşturuyoruz
                        const start = Math.max(0, index - 3);
                        const end = Math.min(words.length, index + 4);
                        let snippet = words.slice(start, end).join(" ");
                        
                        // Bulunan kelimeyi öbek içinde <mark> ile parlat
                        snippet = snippet.replace(queryRegex, "<mark>$1</mark>");

                        const li = document.createElement('li');
                        li.innerHTML = `
                            <span class="search-snippet">...${snippet}...</span>
                            <span class="search-page-badge">Sayfa ${pageNum}</span>
                        `;
                        
                        // TIKLAMA OLAYI: Öbeğe tıklandığında flipbook o sayfaya uçacak
                        li.addEventListener('click', () => {
                            if (pageFlipInstance) {
                                pageFlipInstance.turnToPage(pageNum - 1); // 0 tabanlı indeks
                                if (typeof updateToolbarStatus === 'function') updateToolbarStatus(pageNum);
                                if (typeof updateActiveThumbnail === 'function') updateActiveThumbnail(pageNum - 1);
                            }
                        });

                        listContainer.appendChild(li);
                    }
                });
            }
        } catch (err) {
            console.error(`Arama sırasında ${pageNum}. sayfada hata:`, err);
        }
    }
    
    countSpan.textContent = resultsCount;
    if (resultsCount === 0) {
        listContainer.innerHTML = '<li style="cursor:default; border:none;">Eşleşen terim bulunamadı.</li>';
    }
    
    // Kitabın o an açık olan sayfalarını yeniden render etmeye zorla ki aranan kelime hemen parlasın
	console.log(`"${query}" terimi tüm sayfalarda aranıyor ve highlight edilecek...`);

    // --- ÖNEMLİ KISIM: Tüm Sayfaları Döngüye Alıp Yeniden Boyama ---
    // Toplam sayfa sayısını pdfDoc.numPages üzerinden alıyoruz
    for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
        const pageDiv = document.getElementById(`page-${pageNum}`) || document.querySelector(`[data-page-num="${pageNum}"]`);
        if (!pageDiv) continue; // Eğer sayfa DOM'da henüz yaratılmadıysa pas geç
        // 3. ve 4. PARAMETRE: width ve height
        // Burası kritik! Sabit değer göndermek yerine, flipbook'unuzun o anki 
        // güncel genişlik ve yüksekliğini elementin kendisinden dinamik olarak okumalısınız.
        // Böylece zoom (%80) veya ekran küçülmelerinde mizanpaj asla bozulmaz.
        const width = pageDiv.clientWidth || 600;  
        const height = pageDiv.clientHeight || 800;
		// GÜVENLİ TEMİZLİK: Üst üste binmeyi önlemek için sadece eski canvas ve textLayer'ı siliyoruz
        const oldCanvas = pageDiv.querySelector('canvas');
        const oldTextLayer = pageDiv.querySelector('.textLayer');
        if (oldCanvas) oldCanvas.remove();
        if (oldTextLayer) oldTextLayer.remove();
        // FONKSİYONUN TETİKLENMESİ:
        // Her sayfayı yeni arama terimiyle asenkron olarak arka planda yeniden render eder
        await renderPageLayers(pageNum, pageDiv, width, height);
    }
	//İPUCU: Eğer açık olan mevcut sayfada sarı boyalar hemen görünmezse
    // kütüphaneyi hayali olarak o sayfaya tekrar çevirerek DOM'u tazeleyebilirsiniz:
    if (pageFlipInstance) {
        const currentIndex = pageFlipInstance.getCurrentPageIndex();
        pageFlipInstance.turnToPage(currentIndex); 
    }
}*/
async function executeSearch() {
    const query = document.getElementById('txt-search-term').value.trim();
    const resultsList = document.getElementById('search-results-list');
    const resultsCountSpan = document.getElementById('search-results-count');
    
    if (resultsList) resultsList.innerHTML = "";
    if (resultsCountSpan) resultsCountSpan.textContent = "0";

    if (!query) {
        currentSearchTerm = "";
        // Kitabı tazeleyerek sarı boyaları kaldır
        if (pageFlipInstance) pageFlipInstance.turnToPage(pageFlipInstance.getCurrentPageIndex() + 1);
        return;
    }

    currentSearchTerm = query;
    let totalMatchCount = 0;
    const searchRegex = new RegExp(query, "gi");

    // Arka planda listeyi doldurma motoru
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
                        if (typeof pageFlipInstance !== 'undefined' && pageFlipInstance) {
                            pageFlipInstance.turnToPage(pageNum);
                        }
                    });

                    if (resultsList) resultsList.appendChild(li);
                });
            }
        } catch (err) {
            console.error(err);
        }
    }

    if (resultsCountSpan) resultsCountSpan.textContent = totalMatchCount;

    // 🌟 ARAMA BİTTİĞİNDE KİTABI YENİDEN ÇİZMEYE ZORLA
    // Ekranda açık olan sayfaların div'lerini sıfırlayıp renderPageLayers'ı tetikliyoruz
    if (pageFlipInstance) {
        const currentIndex = pageFlipInstance.getCurrentPageIndex();
        const pagesToForce = [currentIndex + 1, currentIndex + 2];

        pagesToForce.forEach(pageNum => {
            const pageDiv = document.getElementById(`page-${pageNum}`);
            if (pageDiv) {
                // Sadece canvas ve textLayer'ı silip sıfırdan çizdiriyoruz (Zorunlu tetikleme)
                const canvas = pageDiv.querySelector('canvas');
                const textLayer = pageDiv.querySelector('.textLayer');
                const annLayer = pageDiv.querySelector('.annotationLayer');
                if (canvas) canvas.remove();
                if (textLayer) textLayer.remove();
                if (annLayer) annLayer.remove();

                // Genişlik ve yüksekliği dinamik alıp fonksiyonu çağırıyoruz
                const width = pageDiv.clientWidth || 600;
                const height = pageDiv.clientHeight || 800;
                renderPageLayers(pageNum, pageDiv, width, height);
            }
        });
    }
}