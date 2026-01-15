module.exports = async (req, res) => {
    // 1. HEADERS
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
        // 2. FETCH (Native Node.js)
        const response = await fetch(targetUrl, {
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/100.0.0.0 Safari/537.36' 
            }
        });

        if (!response.ok) throw new Error(`Failed to load site: ${response.status}`);

        const html = await response.text();
        const lowerHtml = html.toLowerCase(); // მთლიანი ტექსტი პატარა ასოებით

        // --- 3. ANALYZER (No Libraries, just Logic) ---
        
        const techStack = {
            pms: "Not Detected",
            bookingEngine: "Not Detected",
            analytics: "Not Detected",
            cms: "Custom / Unknown"
        };

        const insights = {
            otaTrap: false,
            schema: false,
            sustainability: false,
            bleisure: false,
            trust: false,
            communication: false
        };

        // --- DETECTION LOGIC (TEXT SEARCH) ---

        // A. Booking & PMS
        const engines = [
            { id: "siteminder", name: "SiteMinder" },
            { id: "cloudbeds", name: "Cloudbeds", pms: true },
            { id: "mews", name: "Mews", pms: true },
            { id: "simplebooking", name: "SimpleBooking" },
            { id: "hotelrunner", name: "HotelRunner" },
            { id: "travelline", name: "TravelLine" },
            { id: "wubook", name: "WuBook" },
            { id: "booking.com", name: "Booking.com Widget" },
            { id: "fina", name: "Fina (Geo)", pms: true },
            { id: "shelter", name: "Shelter", pms: true },
            { id: "guesty", name: "Guesty" },
            { id: "sirvoy", name: "Sirvoy" }
        ];

        engines.forEach(eng => {
            if (lowerHtml.includes(eng.id)) {
                if (eng.id === "booking.com") {
                    if(techStack.bookingEngine === "Not Detected") techStack.bookingEngine = "Booking.com Widget";
                } else {
                    techStack.bookingEngine = eng.name;
                    if(eng.pms) techStack.pms = eng.name;
                }
            }
        });

        // B. CMS
        if (lowerHtml.includes('wp-content')) techStack.cms = "WordPress";
        else if (lowerHtml.includes('wix.com')) techStack.cms = "Wix";
        else if (lowerHtml.includes('squarespace')) techStack.cms = "Squarespace";
        else if (lowerHtml.includes('shopify')) techStack.cms = "Shopify";

        // C. Analytics
        if (lowerHtml.includes('gtag') || lowerHtml.includes('ua-')) techStack.analytics = "Google Analytics";
        if (lowerHtml.includes('fbq(')) techStack.analytics = (techStack.analytics === "Not Detected") ? "Facebook Pixel" : "GA + Pixel";

        // --- INSIGHTS ---
        
        // OTA Trap (თუ Booking ლინკები ბევრია და ძრავა არ ჩანს)
        const bookingLinksCount = (lowerHtml.match(/booking\.com/g) || []).length;
        if (bookingLinksCount > 2 && (techStack.bookingEngine === "Not Detected" || techStack.bookingEngine === "Booking.com Widget")) {
            insights.otaTrap = true;
        }

        // Zero-Click SEO
        if (lowerHtml.includes('application/ld+json')) insights.schema = true;

        // Sustainability
        if (lowerHtml.includes('.webp') || lowerHtml.includes('loading="lazy"')) insights.sustainability = true;

        // Bleisure
        if (lowerHtml.includes('wifi') || lowerHtml.includes('workspace') || lowerHtml.includes('conference')) insights.bleisure = true;

        // Communication
        if (lowerHtml.includes('whatsapp') || lowerHtml.includes('tawk.to') || lowerHtml.includes('messenger')) insights.communication = true;

        // --- SEO (Simple Regex) ---
        const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
        const descMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)["'][^>]*>/i);
        const ogImageMatch = html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']*)["'][^>]*>/i);

        const seoData = {
            title: titleMatch ? titleMatch[1].trim() : "Missing",
            description: descMatch ? descMatch[1] : "Missing",
            ogImage: ogImageMatch ? ogImageMatch[1] : "Missing"
        };

        // --- SCORING ---
        let score = 30;
        if (techStack.bookingEngine !== "Not Detected" && techStack.bookingEngine !== "Booking.com Widget") score += 25;
        if (techStack.pms !== "Not Detected") score += 15;
        if (techStack.analytics !== "Not Detected") score += 10;
        if (insights.schema) score += 5;
        if (insights.communication) score += 5;
        if (!insights.otaTrap) score += 5;
        if (seoData.description !== "Missing" && seoData.description.length > 20) score += 5;

        // RESPONSE
        res.status(200).json({
            success: true,
            domain: cleanUrl,
            score: Math.min(score, 100),
            stack: techStack,
            seo: seoData,
            insights: insights
        });

    } catch (error) {
        // ERROR HANDLING (არ გატყდეს საიტი)
        res.status(200).json({
            success: false,
            domain: cleanUrl,
            error: "Scan Failed",
            score: 20,
            stack: { bookingEngine: "Not Detected" },
            insights: { otaTrap: true }
        });
    }
};
