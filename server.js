const express = require('express');
const fs = require('fs');
const app = express();

//  Libera acesso do navegador
app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
        return res.sendStatus(200);
    }

    next();
});

app.use(express.json());

app.post('/save', (req, res) => {
    const data = req.body;

    fs.writeFile('db.json', JSON.stringify(data, null, 2), err => {
        if (err) {
            console.error(err);
            return res.status(500).json({ error: "Erro ao salvar" });
        }
        res.json({ success: true });
    });
});

app.listen(3000, () => {
    console.log("http://localhost:3000");
});
