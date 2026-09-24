import express from "express";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { Server } from "socket.io";

const { Pool } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 10000;
const JWT_SECRET = process.env.JWT_SECRET || "CHANGE_THIS_IN_RENDER";

if (!process.env.DATABASE_URL) {
  console.warn("DATABASE_URL is not set. Create a Render Postgres database and add its Internal Database URL.");
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

async function query(text, params = []) {
  return pool.query(text, params);
}

async function initDb() {
  if (!process.env.DATABASE_URL) return;
  await query(`
    CREATE TABLE IF NOT EXISTS admins (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS products (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      price INTEGER NOT NULL DEFAULT 0,
      category TEXT DEFAULT 'Populaire',
      emoji TEXT DEFAULT '🍽️',
      active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS orders (
      id SERIAL PRIMARY KEY,
      customer_name TEXT NOT NULL,
      phone TEXT DEFAULT '',
      mode TEXT NOT NULL,
      address TEXT DEFAULT '',
      note TEXT DEFAULT '',
      items JSONB NOT NULL,
      total INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'new',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS chat_messages (
      id SERIAL PRIMARY KEY,
      room TEXT NOT NULL,
      sender_role TEXT NOT NULL,
      sender_name TEXT DEFAULT '',
      message TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  const adminEmail = process.env.ADMIN_EMAIL;
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (adminEmail && adminPassword) {
    const exists = await query("SELECT id FROM admins WHERE email=$1", [adminEmail]);
    if (!exists.rowCount) {
      const hash = await bcrypt.hash(adminPassword, 12);
      await query("INSERT INTO admins(email,password_hash) VALUES($1,$2)", [adminEmail, hash]);
      console.log("Initial admin created.");
    }
  }

  const count = await query("SELECT COUNT(*)::int AS n FROM products");
  if (count.rows[0].n === 0) {
    const demo = [
      ["Pizza Pepperoni","Pizza généreuse au pepperoni.",850,"Populaire","🍕"],
      ["Burger MA-CANDAR","Burger maison, sauce spéciale.",750,"Populaire","🍔"],
      ["Poulet croustillant","Poulet croustillant et savoureux.",900,"Populaire","🍗"],
      ["Cola frais","Boisson fraîche.",150,"Boissons","🥤"],
      ["Jus naturel","Jus frais du moment.",250,"Boissons","🧃"],
      ["Dessert maison","Une douceur pour finir.",300,"Desserts","🍰"]
    ];
    for (const p of demo) await query(
      "INSERT INTO products(name,description,price,category,emoji) VALUES($1,$2,$3,$4,$5)", p
    );
  }
}

function signAdmin(admin) {
  return jwt.sign({ sub: admin.id, email: admin.email, role: "admin" }, JWT_SECRET, { expiresIn: "12h" });
}

function auth(req, res, next) {
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (payload.role !== "admin") throw new Error("role");
    req.admin = payload;
    next();
  } catch {
    res.status(401).json({ error: "Non autorisé." });
  }
}

app.get("/api/products", async (req,res) => {
  try {
    const r = await query("SELECT id,name,description,price,category,emoji,active FROM products WHERE active=true ORDER BY id DESC");
    res.json(r.rows);
  } catch { res.status(500).json({error:"Impossible de charger le catalogue."}); }
});

app.post("/api/orders", async (req,res) => {
  const { customerName, phone, mode, address="", note="", items=[], total=0 } = req.body;
  if (!customerName || !mode || !Array.isArray(items) || !items.length) return res.status(400).json({error:"Commande incomplète."});
  try {
    const r = await query(
      `INSERT INTO orders(customer_name,phone,mode,address,note,items,total)
       VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id,created_at`,
      [customerName,phone||"",mode,address,note,JSON.stringify(items),Number(total)||0]
    );
    res.status(201).json(r.rows[0]);
  } catch { res.status(500).json({error:"Erreur lors de l'enregistrement."}); }
});

app.post("/api/admin/login", async (req,res) => {
  const {email,password} = req.body;
  try {
    const r = await query("SELECT * FROM admins WHERE email=$1", [email]);
    if (!r.rowCount || !(await bcrypt.compare(password, r.rows[0].password_hash))) {
      return res.status(401).json({error:"Email ou mot de passe incorrect."});
    }
    res.json({token:signAdmin(r.rows[0]), email:r.rows[0].email});
  } catch { res.status(500).json({error:"Serveur indisponible."}); }
});

app.get("/api/admin/me", auth, (req,res)=>res.json({email:req.admin.email}));

app.get("/api/admin/products", auth, async (req,res) => {
  const r = await query("SELECT * FROM products ORDER BY id DESC");
  res.json(r.rows);
});

app.post("/api/admin/products", auth, async (req,res) => {
  const {name,description="",price=0,category="Populaire",emoji="🍽️",active=true}=req.body;
  if (!name) return res.status(400).json({error:"Nom requis."});
  const r=await query(
    "INSERT INTO products(name,description,price,category,emoji,active) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",
    [name,description,Number(price)||0,category,emoji,!!active]
  );
  res.status(201).json(r.rows[0]);
});

app.put("/api/admin/products/:id", auth, async (req,res) => {
  const {name,description="",price=0,category="Populaire",emoji="🍽️",active=true}=req.body;
  const r=await query(
    `UPDATE products SET name=$1,description=$2,price=$3,category=$4,emoji=$5,active=$6,updated_at=NOW()
     WHERE id=$7 RETURNING *`,
    [name,description,Number(price)||0,category,emoji,!!active,req.params.id]
  );
  res.json(r.rows[0]);
});

app.delete("/api/admin/products/:id", auth, async (req,res) => {
  await query("DELETE FROM products WHERE id=$1",[req.params.id]);
  res.json({ok:true});
});

app.get("/api/admin/orders", auth, async (req,res) => {
  const r=await query("SELECT * FROM orders ORDER BY created_at DESC LIMIT 200");
  res.json(r.rows);
});

app.patch("/api/admin/orders/:id", auth, async (req,res) => {
  const allowed=["new","confirmed","preparing","ready","completed","cancelled"];
  if(!allowed.includes(req.body.status)) return res.status(400).json({error:"Statut invalide."});
  const r=await query("UPDATE orders SET status=$1 WHERE id=$2 RETURNING *",[req.body.status,req.params.id]);
  res.json(r.rows[0]);
});

app.get("/api/admin/chat/:room", auth, async (req,res) => {
  const r=await query("SELECT * FROM chat_messages WHERE room=$1 ORDER BY created_at ASC LIMIT 300",[req.params.room]);
  res.json(r.rows);
});

io.on("connection", socket => {
  socket.on("join", room => {
    if (typeof room !== "string" || !room || room.length > 80) return;
    socket.join(room);
  });

  socket.on("message", async data => {
    const room=String(data?.room||"").slice(0,80);
    const message=String(data?.message||"").trim().slice(0,1000);
    const role=data?.role==="admin"?"admin":"client";
    const senderName=String(data?.senderName||"Client").slice(0,80);
    if(!room || !message || !process.env.DATABASE_URL) return;
    const r=await query(
      "INSERT INTO chat_messages(room,sender_role,sender_name,message) VALUES($1,$2,$3,$4) RETURNING *",
      [room,role,senderName,message]
    );
    io.to(room).emit("message",r.rows[0]);
  });
});

app.get("*",(req,res)=>{
  if(req.path.startsWith("/api/")) return res.status(404).end();
  res.sendFile(path.join(__dirname,"public","index.html"));
});

initDb().then(()=>server.listen(PORT,()=>console.log(`MA-CANDAR V3 on ${PORT}`)))
  .catch(err=>{console.error(err);process.exit(1)});
