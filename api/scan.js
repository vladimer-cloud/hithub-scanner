const fetch = require('node-fetch');
const cheerio = require('cheerio');

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();

    const { url } = req.query;
    if (!url) return res.status(400).json({ error: 'URL missing' });

    let cleanUrl = url.replace(/^https?:\/\//, '').replace(/\/$/, '');
    const targetUrl = `https://${cleanUrl}`;

    try {
        const response = await fetch(targetUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36' },
            timeout: 8000
        });

        const html = await response.text();
        const $ = cheerio.load(html);
        const fullText = ($.html() + $('script').text()).toLowerCase();

        // --- 1. TECH STACK (Operations) ---
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

        // Analytics
        if (fullText.includes('gtag') || fullText.includes('ua-')) techStack.analytics = "Google Analytics";
        else if (fullText.includes('fbq(')) techStack.analytics = "Facebook Pixel";

        // Booking Engines & Channel Managers
        if (fullText.includes('siteminder')) techStack.bookingEngine = "SiteMinder";
        else if (fullText.includes('cloudbeds')) { techStack.bookingEngine = "Cloudbeds"; techStack.pms = "Cloudbeds"; }
        else if (fullText.includes('mews')) { techStack.bookingEngine = "Mews"; techStack.pms = "Mews"; }
        else if (fullText.includes('simplebooking')) techStack.bookingEngine = "SimpleBooking";
        else if (fullText.includes('hotelrunner')) techStack.bookingEngine = "HotelRunner";
        else if (fullText.includes('booking.com')) techStack.bookingEngine = "Booking.com Widget (Basic)";

        // --- 2. SEO & VISIBILITY (New!) ---
        const seo = {
            title: $('title').text().trim() || "Missing",
            description: $('meta[name="description"]').attr('content') || "Missing",
            ogImage: $('meta[property="og:image"]').attr('content') || "Missing",
            h1: $('h1').length > 0 ? "Present" : "Missing"
        };

        // --- 3. SCORING LOGIC ---
        let score = 30; // Base score
        if (techStack.pms !== "Not Detected") score += 20;
        if (techStack.bookingEngine !== "Not Detected") score += 20;
        if (techStack.analytics !== "Not Detected") score += 10;
        if (seo.description !== "Missing" && seo.description.length > 10) score += 10;
        if (seo.ogImage !== "Missing") score += 5;
        if (techStack.cms !== "Custom / Unknown") score += 5;

        res.status(200).json({
            success: true,
            domain: cleanUrl,
            score: Math.min(score, 100),
            stack: techStack,
            seo: seo
        });

    } catch (error) {
        res.status(200).json({
            success: false,
            domain: cleanUrl,
            error: "Scan failed",
            score: 25,
            stack: { pms: "Not Detected", bookingEngine: "Not Detected" },
            seo: { title: "Error", description: "Missing" }
        });
    }
};
};
