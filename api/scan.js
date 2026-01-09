const fetch = require('node-fetch');
const cheerio = require('cheerio');

module.exports = async (req, res) => {
    // 1. CORS - რომ ყველა ბრაუზერიდან იმუშაოს (ინკოგნიტოშიც)
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

    // თუ უბრალოდ ხელის შევლებაა (OPTIONS request), ვპასუხობთ OK
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    const { url } = req.query;

    if (!url) {
        return res.status(400).json({ error: 'გთხოვთ მიუთითოთ URL (?url=...)' });
    }

    // დომენის გასუფთავება და https-ის მიბმა
    let cleanUrl = url.replace(/^https?:\/\//, '').replace(/\/$/, '');
    const targetUrl = `https://${cleanUrl}`;

    try {
        console.log(`Scanning: ${targetUrl}`);

        // 2. საიტის წაკითხვა (8 წამიანი ლიმიტით)
        const response = await fetch(targetUrl, {
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36' 
            },
            timeout: 8000 
        });

        const html = await response.text();
        const $ = cheerio.load(html);

        // ტექსტის გაერთიანება ანალიზისთვის (პატარა ასოებით)
        const scripts = $('script').map((i, el) => $(el).attr('src') || $(el).html()).get().join(' ');
        const metaTags = $('meta').map((i, el) => $(el).attr('content') || '').get().join(' ');
        const title = $('title').text();
        const fullText = (scripts + metaTags + title).toLowerCase();

        // 3. ტექნოლოგიების ძებნა
        const techStack = {
            pms: "Not Detected",
            cms: "Custom / Unknown",
            analytics: "Not Detected",
            bookingEngine: "Not Detected"
        };

        // CMS
        if (fullText.includes('wp-content') || fullText.includes('wordpress')) techStack.cms = "WordPress";
        else if (fullText.includes('wix.com') || fullText.includes('wix-')) techStack.cms = "Wix";
        else if (fullText.includes('squarespace')) techStack.cms = "Squarespace";

        // Analytics
        if (fullText.includes('gtag') || fullText.includes('google-analytics') || fullText.includes('ua-')) techStack.analytics = "Google Analytics";
        else if (fullText.includes('fbq(') || fullText.includes('fbevents.js')) techStack.analytics = "Facebook Pixel";

        // Booking Engine (სასტუმროსთვის)
        if (fullText.includes('siteminder')) techStack.bookingEngine = "SiteMinder";
        else if (fullText.includes('mews')) techStack.bookingEngine = "Mews";
        else if (fullText.includes('cloudbeds')) techStack.bookingEngine = "Cloudbeds";
        else if (fullText.includes('simplebooking')) techStack.bookingEngine = "SimpleBooking";
        else if (fullText.includes('booking.com')) techStack.bookingEngine = "Booking.com Widget";

        // 4. ბიზნესის ტიპის გამოცნობა
        let detectedType = "other";
        const bodyText = $('body').text().toLowerCase().slice(0, 5000);
        
        if (bodyText.includes('hotel') || bodyText.includes('room') || bodyText.includes('stay') || bodyText.includes('სასტუმრო')) detectedType = "hotel";
        else if (bodyText.includes('wine') || bodyText.includes('vineyard') || bodyText.includes('tasting') || bodyText.includes('მარანი')) detectedType = "winery";
        else if (bodyText.includes('menu') || bodyText.includes('restaurant') || bodyText.includes('food') || bodyText.includes('რესტორანი')) detectedType = "restaurant";

        // 5. ქულის დათვლა
        let score = 40;
        if (techStack.cms !== "Custom / Unknown") score += 15;
        if (techStack.bookingEngine !== "Not Detected") score += 25;
        if (techStack.analytics !== "Not Detected") score += 10;
        if (targetUrl.startsWith("https")) score += 10;

        res.status(200).json({
            success: true,
            domain: cleanUrl,
            type: detectedType,
            score: score,
            stack: techStack
        });

    } catch (error) {
        console.error(error);
        // თუ ვერ შევიდა, ვაბრუნებთ შეცდომას, მაგრამ ლამაზად
        res.status(200).json({
            success: false,
            domain: cleanUrl,
            error: "საიტი ვერ გაიხსნა ან დაბლოკილია.",
            type: "unknown",
            score: 20,
            stack: { pms: "Unknown", cms: "Unknown" }
        });
    }
};
