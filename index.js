import dotenv from "dotenv";
dotenv.config(); // Load environment variables

import express from "express";
import bodyParser from "body-parser";
import pkg from "pg";
const { Pool } = pkg;
import bcrypt from "bcrypt";

const app = express();
const port = 3000;
const saltRounds = 10;

// Initialize PostgreSQL connection using DATABASE_URL from Railway
const pool = new Pool({
  connectionString: process.env.DATABASE_URL, // Use DATABASE_URL from environment variables
  ssl: {
    rejectUnauthorized: false, // Enable SSL for secure connection to Railway's database
  },
});

pool.connect()
  .then(() => console.log("Connected to the PostgreSQL database."))
  .catch((err) => console.error("Database connection error:", err));

// Create tables if they don't exist
const initDB = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        username TEXT NOT NULL,
        password TEXT NOT NULL
      );
      
      CREATE TABLE IF NOT EXISTS applications (
        id SERIAL PRIMARY KEY,
        jobtitle TEXT NOT NULL,
        company TEXT NOT NULL,
        status TEXT NOT NULL,
        dateapplied DATE NOT NULL
      );
    `);
    console.log("Tables ensured.");
  } catch (err) {
    console.error("Error initializing database:", err);
  }
};

initDB();

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.set("views", "./views");
app.set("view engine", "ejs");

// Middleware to log incoming requests
app.use((req, res, next) => {
  console.log(`Incoming request: ${req.method} ${req.url}`);
  next();
});

// Utility function to fetch user by email
const getUserByEmail = async (email) => {
  try {
    const result = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
    return result.rows[0];
  } catch (err) {
    console.error("Error fetching user:", err);
    throw err;
  }
};

// Routes
app.get("/", (req, res) => res.render("home"));
app.get("/logout", (req, res) => res.render("home"));
app.get("/login", (req, res) => res.render("login"));
app.get("/register", (req, res) => res.render("register"));

app.post("/register", async (req, res) => {
  const { email, username, password } = req.body;

  try {
    const existingUser = await getUserByEmail(email);
    if (existingUser) {
      return res.send("Email already exists. Try logging in.");
    }

    const hash = await bcrypt.hash(password, saltRounds);
    await pool.query("INSERT INTO users (email, username, password) VALUES ($1, $2, $3)", 
      [email, username, hash]);
    res.redirect("/dashboard");
  } catch (err) {
    console.error("Registration error:", err);
    res.status(500).send("Internal Server Error");
  }
});

app.post("/login", async (req, res) => {
  const { email, password } = req.body;

  try {
    const user = await getUserByEmail(email);
    if (!user) {
      return res.send("User not found");
    }

    const match = await bcrypt.compare(password, user.password);
    if (match) {
      res.redirect("/dashboard");
    } else {
      res.send("Incorrect Password");
    }
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).send("Internal Server Error");
  }
});

// Route to render the add application form
app.get("/add-application", (req, res) => {
  res.render("addEdit", { application: null });
});

// Route to render the edit application form
app.get("/edit-application/:id", async (req, res) => {
  const applicationId = req.params.id;

  try {
    const result = await pool.query("SELECT * FROM applications WHERE id = $1", [applicationId]);
    if (result.rows.length > 0) {
      res.render("addEdit", { application: result.rows[0] });
    } else {
      res.status(404).send("Application not found");
    }
  } catch (err) {
    console.error("Error fetching application:", err);
    res.status(500).send("Internal Server Error");
  }
});

// Route to fetch applications as JSON
app.get("/api/applications", async (req, res) => {
  const sortColumn = req.query.sort || "dateapplied";
  const sortOrder = req.query.order || "DESC";
  const page = parseInt(req.query.page) || 1;
  const limit = 10;
  const offset = (page - 1) * limit;

  try {
    const result = await pool.query(
      `SELECT * FROM applications ORDER BY ${sortColumn} ${sortOrder} LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    const countResult = await pool.query("SELECT COUNT(*) AS count FROM applications");
    res.json({
      applications: result.rows,
      total: countResult.rows[0].count,
    });
  } catch (err) {
    console.error("Error fetching applications:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// Route to fetch stats
app.get("/api/stats", async (req, res) => {
  try {
    const totalApplications = await pool.query("SELECT COUNT(*) AS total FROM applications");
    const interviewsScheduled = await pool.query(
      "SELECT COUNT(*) AS total FROM applications WHERE status = 'Interview Scheduled'"
    );
    const offersReceived = await pool.query(
      "SELECT COUNT(*) AS total FROM applications WHERE status = 'Offer Received'"
    );

    res.json({
      totalApplications: totalApplications.rows[0].total,
      interviewsScheduled: interviewsScheduled.rows[0].total,
      offersReceived: offersReceived.rows[0].total,
    });
  } catch (err) {
    console.error("Error fetching stats:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

app.get("/dashboard", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM applications ORDER BY dateapplied DESC");
    res.render("dashboard", { applications: result.rows });
  } catch (err) {
    console.error("Error fetching dashboard data:", err);
    res.status(500).send("Internal Server Error");
  }
});

// Route to save a new or updated application
app.post("/api/applications/:id?", async (req, res) => {
  const { jobtitle, company, status, dateapplied } = req.body;
  const applicationId = req.params.id;

  try {
    if (applicationId) {
      await pool.query(
        "UPDATE applications SET jobtitle = $1, company = $2, status = $3, dateapplied = $4 WHERE id = $5",
        [jobtitle, company, status, dateapplied, applicationId]
      );
    } else {
      await pool.query(
        "INSERT INTO applications (jobtitle, company, status, dateapplied) VALUES ($1, $2, $3, $4)",
        [jobtitle, company, status, dateapplied]
      );
    }
    res.redirect("/dashboard");
  } catch (err) {
    console.error("Error saving application:", err);
    res.status(500).send("Internal Server Error");
  }
});

// Route to delete an application
app.post("/delete-application/:id", async (req, res) => {
  const applicationId = req.params.id;

  try {
    await pool.query("DELETE FROM applications WHERE id = $1", [applicationId]);
    res.redirect("/dashboard");
  } catch (err) {
    console.error("Error deleting application:", err);
    res.status(500).send("Internal Server Error");
  }
});

// Serve static files
app.use(express.static("public"));

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
