const cheerio = require('cheerio');

module.exports = async (req, res) => {
    // 1. HEADERS & SETUP
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();

    const { url } = req.query;
    if (!url) return res.status(400).json({ error: 'URL missing' });

    let cleanUrl = url.replace(/^https?:\/\//, '').replace(/\/$/, '');
    if (!cleanUrl.includes('.')) return res.status(400).json({ error: 'Invalid URL' });
    
    const targetUrl = `https://${cleanUrl}`;

    try {
        // 2. FETCHING (Native)
        const response = await fetch(targetUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/100.0.0.0 Safari/537.36' }
        });

        if (!response.ok) throw new Error(`Failed: ${response.status}`);

        const html = await response.text();
        const $ = cheerio.load(html);
        
        // ანალიზისთვის ვიღებთ მთლიან ტექსტს და სკრიპტებს
        const fullHTML = $.html().toLowerCase();
        const bodyText = $('body').text().toLowerCase();

        // --- 3. TECH STACK IDENTIFICATION (THE CORE) ---
        const techStack = {
            pms: "Not Detected",
            bookingEngine: "Not Detected",
            analytics: "Not Detected",
            cms: "Custom / Unknown",
            widgets: []
        };

        // A. Booking Engines & PMS (The Mega List)
        const engines = [
            { id: "siteminder", name: "SiteMinder" },
            { id: "cloudbeds", name: "Cloudbeds", pms: true },
            { id: "mews", name: "Mews", pms: true },
            { id: "simplebooking", name: "SimpleBooking" },
            { id: "hotelrunner", name: "HotelRunner" },
            { id: "travelline", name: "TravelLine" },
            { id: "wubook", name: "WuBook" },
            { id: "booking.com", name: "Booking.com Widget" }, // ეს არ არის ძრავა, ეს ვიჯეტია
            { id: "fina", name: "Fina (Geo)", pms: true },
            { id: "shelter", name: "Shelter", pms: true },
            { id: "guesty", name: "Guesty" },
            { id: "sirvoy", name: "Sirvoy" },
            { id: "littlehotelier", name: "Little Hotelier" }
        ];

        engines.forEach(eng => {
            if (fullHTML.includes(eng.id)) {
                if (eng.id === "booking.com") {
                    // Booking.com ვიჯეტი არ ითვლება "საკუთარ ძრავად"
                    if(techStack.bookingEngine === "Not Detected") techStack.bookingEngine = "Booking.com Widget";
                } else {
                    techStack.bookingEngine = eng.name;
                    if(eng.pms) techStack.pms = eng.name;
                }
            }
        });

        // B. CMS
        if (fullHTML.includes('wp-content')) techStack.cms = "WordPress";
        else if (fullHTML.includes('wix.com')) techStack.cms = "Wix";
        else if (fullHTML.includes('squarespace')) techStack.cms = "Squarespace";
        else if (fullHTML.includes('shopify')) techStack.cms = "Shopify";

        // C. Analytics
        if (fullHTML.includes('gtag') || fullHTML.includes('ua-')) techStack.analytics = "Google Analytics";
        if (fullHTML.includes('fbq(')) techStack.analytics = (techStack.analytics === "Not Detected") ? "Facebook Pixel" : "GA + Pixel";

        // --- 4. BUSINESS INTELLIGENCE (HIT.LOGIC) ---
        
        const insights = {
            otaTrap: false,        // გადადის თუ არა პირდაპირ Booking-ზე
            schema: false,         // აქვს თუ არა Google-ის სტრუქტურა
            sustainability: false, // არის თუ არა ოპტიმიზებული (WebP, Lazy)
            bleisure: false,       // სამუშაო გარემო
            trust: false,          // რევიუები
            communication: false   // ჩატი
        };

        // 4.1 OTA TRAP DETECTIVE
        // ვეძებთ ლინკებს, რომლებიც მიდიან Booking.com-ზე
        let otaLinks = 0;
        $('a').each((i, link) => {
            const href = $(link).attr('href');
            if (href && (href.includes('booking.com') || href.includes('expedia') || href.includes('airbnb'))) {
                otaLinks++;
            }
        });
        // თუ ძრავა არ აქვს და ლინკები აქვს -> Trap არის
        if (otaLinks > 0 && (techStack.bookingEngine === "Not Detected" || techStack.bookingEngine === "Booking.com Widget")) {
            insights.otaTrap = true;
        }

        // 4.2 ZERO-CLICK SEO (Schema Markup)
        if (fullHTML.includes('application/ld+json')) {
            insights.schema = true;
        }

        // 4.3 DIGITAL SUSTAINABILITY
        // ვამოწმებთ სურათებს - აქვს თუ არა WebP ან Lazy Loading
        if (fullHTML.includes('.webp') || fullHTML.includes('loading="lazy"')) {
            insights.sustainability = true;
        }

        // 4.4 BLEISURE TARGETING
        // ვეძებთ სიტყვებს: wifi, work, desk, conference
        const bleisureKeywords = ['wifi', 'wi-fi', 'workspace', 'desk', 'conference', 'meeting', 'coworking', 'remote'];
        if (bleisureKeywords.some(keyword => bodyText.includes(keyword))) {
            insights.bleisure = true;
        }

        // 4.5 TRUST & COMMUNICATION
        if (fullHTML.includes('tripadvisor') || fullHTML.includes('trustpilot')) insights.trust = true;
        if (fullHTML.includes('whatsapp') || fullHTML.includes('tawk.to') || fullHTML.includes('intercom') || fullHTML.includes('messenger')) {
            insights.communication = true;
        }

        // --- 5. SCORING ALGORITHM ---
        let score = 30; // Base score

        // Tech Stack Impact
        if (techStack.bookingEngine !== "Not Detected" && techStack.bookingEngine !== "Booking.com Widget") score += 25; // ძრავა მთავარია
        if (techStack.pms !== "Not Detected") score += 15;
        if (techStack.analytics !== "Not Detected") score += 10;

        // Insights Impact
        if (insights.schema) score += 5;
        if (insights.sustainability) score += 5;
        if (insights.communication) score += 5;
        if (!insights.otaTrap) score += 5; // თუ მახეში არ არიან, ქულა ემატებათ

        // SEO Basic
        const title = $('title').text().trim();
        const desc = $('meta[name="description"]').attr('content');
        const seoData = {
            title: title.substring(0, 60) || "Missing",
            description: desc || "Missing",
            ogImage: $('meta[property="og:image"]').attr('content') || "Missing"
        };
        
        res.status(200).json({
            success: true,
            domain: cleanUrl,
            score: Math.min(score, 100),
            stack: techStack,
            seo: seoData,
            insights: insights // ვაბრუნებთ ახალ ინტელექტს
        });

    } catch (error) {
        console.error(error);
        res.status(200).json({
            success: false,
            domain: cleanUrl,
            error: "Scan Failed",
            score: 25,
            stack: { bookingEngine: "Not Detected" },
            insights: { otaTrap: true } // თუ სკანირება ჩავარდა, ჩავთვალოთ რომ ცუდადაა საქმე
        });
    }
};
};
