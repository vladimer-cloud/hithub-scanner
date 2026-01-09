const fetch = require('node-fetch');
const cheerio = require('cheerio');

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    const { url } = req.query;

    if (!url) return res.status(400).json({ error: 'No URL provided' });

    const targetUrl = url.startsWith('http') ? url : `https://${url}`;

    try {
        const response = await fetch(targetUrl, { 
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; HITHubBot/1.0)' }, 
            timeout: 8000 
        });
        const html = await response.text();
        const $ = cheerio.load(html);

        // მარტივი ლოგიკა ტექსტის ანალიზისთვის
        const fullText = ($('script').text() + $('meta').attr('content') + $('title').text()).toLowerCase();

        const techStack = { 
            pms: "Not Detected", 
            bookingEngine: "Not Detected", 
            analytics: "Not Detected" 
        };

        // ძიების ლოგიკა
        if (fullText.includes('siteminder')) techStack.bookingEngine = "SiteMinder";
        if (fullText.includes('cloudbeds')) techStack.pms = "Cloudbeds";
        if (fullText.includes('wix')) techStack.cms = "Wix";
        if (fullText.includes('wordpress')) techStack.cms = "WordPress";
        if (fullText.includes('google-analytics')) techStack.analytics = "Google Analytics";

        // ტიპის დადგენა
        let type = "other";
        if(fullText.includes('hotel') || fullText.includes('stay') || fullText.includes('room')) type = "hotel";
        else if(fullText.includes('wine') || fullText.includes('marani') || fullText.includes('tasting')) type = "winery";

        res.status(200).json({ 
            success: true, 
            domain: targetUrl,
            type, 
            stack: techStack, 
            score: Math.floor(Math.random() * 30) + 50 // დროებითი რენდომ ქულა
        });

    } catch (error) {
        res.status(200).json({ success: false, error: "Failed to scan website" });
    }
}
