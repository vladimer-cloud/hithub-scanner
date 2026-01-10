const cheerio = require('cheerio');

module.exports = async (req, res) => {
    // 1. CORS და უსაფრთხოება
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();

    const { url } = req.query;
    if (!url) return res.status(400).json({ error: 'URL missing' });

    // 2. URL-ის გასუფთავება
    let cleanUrl = url.replace(/^https?:\/\//, '').replace(/\/$/, '');
    // თუ მომხმარებელმა რაღაც სისულელე ჩაწერა (წერტილის გარეშე), არ გავტეხოთ სერვერი
    if (!cleanUrl.includes('.')) return res.status(400).json({ error: 'Invalid URL' });
    
    const targetUrl = `https://${cleanUrl}`;

    try {
        // 3. NATIVE FETCH (ბიბლიოთეკის გარეშე!)
        // ეს არის მთავარი ცვლილება - ვიყენებთ ჩაშენებულ fetch-ს
        const response = await fetch(targetUrl, {
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/100.0.0.0 Safari/537.36' 
            }
        });

        // თუ საიტი არ იხსნება (მაგ: 404 ან 500), გადავდივართ catch-ში
        if (!response.ok) throw new Error(`Failed to load site: ${response.status}`);

        const html = await response.text();
        const $ = cheerio.load(html);
        
        // ტექსტის შეგროვება ანალიზისთვის
        const fullText = ($.html() + $('script').text()).toLowerCase();

        // --- 4. დეტექტივი იწყებს მუშაობას ---
        const techStack = {
            pms: "Not Detected",
            bookingEngine: "Not Detected",
            analytics: "Not Detected",
            cms: "Custom / Unknown"
        };

        // CMS
        if (fullText.includes('wp-content')) techStack.cms = "WordPress";
        else if (fullText.includes('wix.com')) techStack.cms = "Wix";
        else if (fullText.includes('squarespace')) techStack.cms = "Squarespace";
        else if (fullText.includes('shopify')) techStack.cms = "Shopify";
        else if (fullText.includes('joomla')) techStack.cms = "Joomla";

        // Analytics
        if (fullText.includes('gtag') || fullText.includes('ua-') || fullText.includes('google-analytics')) techStack.analytics = "Google Analytics";
        else if (fullText.includes('fbq(')) techStack.analytics = "Facebook Pixel";
        else if (fullText.includes('hotjar')) techStack.analytics = "Hotjar";

        // Booking & PMS
        if (fullText.includes('siteminder')) techStack.bookingEngine = "SiteMinder";
        else if (fullText.includes('cloudbeds')) { techStack.bookingEngine = "Cloudbeds"; techStack.pms = "Cloudbeds"; }
        else if (fullText.includes('mews')) { techStack.bookingEngine = "Mews"; techStack.pms = "Mews"; }
        else if (fullText.includes('simplebooking')) techStack.bookingEngine = "SimpleBooking";
        else if (fullText.includes('hotelrunner')) techStack.bookingEngine = "HotelRunner";
        else if (fullText.includes('booking.com')) techStack.bookingEngine = "Booking.com Widget";
        else if (fullText.includes('clock-software') || fullText.includes('clockpms')) techStack.pms = "Clock PMS";

        // --- 5. SEO CHECK ---
        const seo = {
            title: $('title').text().trim() || "Missing",
            description: $('meta[name="description"]').attr('content') || "Missing",
            ogImage: $('meta[property="og:image"]').attr('content') || "Missing"
        };

        // --- 6. SCORING ---
        let score = 30; // საბაზისო ქულა
        if (techStack.pms !== "Not Detected") score += 20;
        if (techStack.bookingEngine !== "Not Detected") score += 20;
        if (techStack.analytics !== "Not Detected") score += 10;
        if (seo.description !== "Missing" && seo.description.length > 10) score += 10;
        if (seo.ogImage !== "Missing") score += 10;
        if (targetUrl.startsWith('https')) score += 5;

        // პასუხის დაბრუნება
        res.status(200).json({
            success: true,
            domain: cleanUrl,
            score: Math.min(score, 100),
            stack: techStack,
            seo: seo
        });

    } catch (error) {
        console.error("Scan Error:", error);
        // კრაშის ნაცვლად, ვაბრუნებთ "რბილ" შეცდომას, რომ საიტმა არ გაჭედოს
        res.status(200).json({
            success: false,
            domain: cleanUrl,
            error: "Scan failed or site blocked scanner",
            score: 20, // დაბალი ქულა
            stack: { 
                pms: "Not Detected", 
                bookingEngine: "Not Detected", 
                analytics: "Not Detected", 
                cms: "Unknown" 
            },
            seo: { description: "Missing", ogImage: "Missing" }
        });
    }
};
