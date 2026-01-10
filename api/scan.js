const cheerio = require('cheerio');

module.exports = async (req, res) => {
    // Standard Headers
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
        const response = await fetch(targetUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/100.0.0.0 Safari/537.36' }
        });

        if (!response.ok) throw new Error(`Failed to load site`);

        const html = await response.text();
        const $ = cheerio.load(html);
        const fullText = ($.html() + $('script').text()).toLowerCase();

        // --- MEGA DETECTOR: 50+ SYSTEMS ---
        const techStack = {
            pms: "Not Detected",
            bookingEngine: "Not Detected",
            analytics: "Not Detected",
            cms: "Custom / Unknown"
        };

        // 1. CMS / WEBSITE BUILDERS
        if (fullText.includes('wp-content')) techStack.cms = "WordPress";
        else if (fullText.includes('wix.com')) techStack.cms = "Wix";
        else if (fullText.includes('squarespace')) techStack.cms = "Squarespace";
        else if (fullText.includes('shopify')) techStack.cms = "Shopify";
        else if (fullText.includes('joomla')) techStack.cms = "Joomla";
        else if (fullText.includes('bitrix')) techStack.cms = "Bitrix24";
        else if (fullText.includes('webflow')) techStack.cms = "Webflow";

        // 2. ANALYTICS & TRACKING
        if (fullText.includes('gtag') || fullText.includes('google-analytics')) techStack.analytics = "Google Analytics";
        else if (fullText.includes('fbq(') || fullText.includes('fbevents.js')) techStack.analytics = "Facebook Pixel";
        else if (fullText.includes('hotjar')) techStack.analytics = "Hotjar";
        else if (fullText.includes('yandex.metrika')) techStack.analytics = "Yandex Metrica";

        // 3. BOOKING ENGINES & PMS (The Big List)
        const engines = [
            { id: "siteminder", name: "SiteMinder" },
            { id: "cloudbeds", name: "Cloudbeds", pms: true },
            { id: "mews", name: "Mews", pms: true },
            { id: "simplebooking", name: "SimpleBooking" },
            { id: "hotelrunner", name: "HotelRunner" },
            { id: "travelline", name: "TravelLine" },
            { id: "wubook", name: "WuBook" },
            { id: "yieldplanet", name: "YieldPlanet" },
            { id: "profitroom", name: "Profitroom" },
            { id: "d-edge", name: "D-EDGE" },
            { id: "synxis", name: "Sabre SynXis" },
            { id: "travelclick", name: "Amadeus / TravelClick" },
            { id: "mirai", name: "Mirai" },
            { id: "bookologic", name: "Bookologic" },
            { id: "clock-software", name: "Clock PMS", pms: true },
            { id: "opera", name: "Oracle Opera (Web)", pms: true },
            { id: "fina", name: "Fina (Geo)", pms: true }, // ქართული
            { id: "softg", name: "SoftG (Geo)", pms: true }, // ქართული
            { id: "shelter", name: "Shelter", pms: true },
            { id: "sirvoy", name: "Sirvoy" },
            { id: "littlehotelier", name: "Little Hotelier" },
            { id: "guesty", name: "Guesty" },
            { id: "smoobu", name: "Smoobu" },
            { id: "lodgify", name: "Lodgify" }
        ];

        // ძებნა სიაში
        engines.forEach(engine => {
            if (fullText.includes(engine.id)) {
                techStack.bookingEngine = engine.name;
                if(engine.pms) techStack.pms = engine.name;
            }
        });

        // თუ მაინც ვერ იპოვა, მაგრამ Booking.com-ის ვიჯეტი უდევს
        if (techStack.bookingEngine === "Not Detected" && fullText.includes('booking.com')) {
            techStack.bookingEngine = "Booking.com Widget (Not an Engine)";
        }

        // --- SEO CHECK ---
        const seo = {
            title: $('title').text().trim().substring(0, 60) || "Missing",
            description: $('meta[name="description"]').attr('content') || "Missing",
            ogImage: $('meta[property="og:image"]').attr('content') || "Missing"
        };

        // --- SCORING ---
        let score = 30;
        if (techStack.pms !== "Not Detected") score += 20;
        if (techStack.bookingEngine !== "Not Detected" && !techStack.bookingEngine.includes("Widget")) score += 25;
        if (techStack.analytics !== "Not Detected") score += 10;
        if (seo.description !== "Missing" && seo.description.length > 20) score += 10;
        if (seo.ogImage !== "Missing") score += 5;

        res.status(200).json({ success: true, domain: cleanUrl, score: Math.min(score, 100), stack: techStack, seo: seo });

    } catch (error) {
        console.error(error);
        res.status(200).json({ success: false, error: "Scan Error", score: 20, stack: techStack, seo: { description: "Error" } });
    }
};
