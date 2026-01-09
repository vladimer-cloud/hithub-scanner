export default function handler(req, res) {
    res.status(200).json({ 
        message: "გამარჯობა! მე ვარ HIT Hub-ის სერვერი და მე ცოცხალი ვარ! 🚀", 
        time: new Date().toString() 
    });
}
