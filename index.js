import dotenv from "dotenv";
dotenv.config(); // Load environment variables

// Existing dependencies
import express from "express";
import bodyParser from "body-parser";
import pg from "pg";
import bcrypt from "bcrypt";

const app = express();
const port = 3000;
const saltRounds = 10;

// Database configuration
const { Pool } = pg;

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
});

console.log("Environment variables loaded");

// Test database connection
pool.connect()
  .then(() => console.log("Database connected successfully"))
  .catch((err) => {
    console.error("Database connection error:", err);
    process.exit(1);
  });

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
  const result = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
  return result.rows[0];
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
    await pool.query(
      "INSERT INTO users (email, username, password) VALUES ($1, $2, $3)",
      [email, username, hash]
    );
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
    const validColumns = ["dateapplied", "jobtitle", "company", "status"];
    const validOrder = ["ASC", "DESC"];

    if (!validColumns.includes(sortColumn) || !validOrder.includes(sortOrder)) {
      throw new Error("Invalid sorting parameters");
    }

    const applications = await pool.query(
      `SELECT * FROM applications ORDER BY ${sortColumn} ${sortOrder} LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    const totalApplications = await pool.query("SELECT COUNT(*) FROM applications");
    res.json({
      applications: applications.rows,
      total: parseInt(totalApplications.rows[0].count),
    });
  } catch (err) {
    console.error("Error fetching applications:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// Route to fetch stats
app.get("/api/stats", async (req, res) => {
  try {
    const totalApplicationsResult = await pool.query("SELECT COUNT(*) FROM applications");
    const interviewsScheduledResult = await pool.query(
      "SELECT COUNT(*) FROM applications WHERE status = 'Interview Scheduled'"
    );
    const offersReceivedResult = await pool.query(
      "SELECT COUNT(*) FROM applications WHERE status = 'Offer Received'"
    );

    res.json({
      totalApplications: parseInt(totalApplicationsResult.rows[0].count),
      interviewsScheduled: parseInt(interviewsScheduledResult.rows[0].count),
      offersReceived: parseInt(offersReceivedResult.rows[0].count),
    });
  } catch (err) {
    console.error("Error fetching stats:", err);
    res.status(500).json({ error: "Internal Server Error" });
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

// Dashboard route
app.get("/dashboard", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM applications ORDER BY dateapplied DESC");
    res.render("dashboard", { applications: result.rows });
  } catch (err) {
    console.error("Error fetching applications:", err);
    res.status(500).send("Internal Server Error");
  }
});

// Serve static files
app.use(express.static("public"));

// Handle undefined routes
app.use((req, res) => {
  res.status(404).json({ error: "API endpoint not found" });
});

// Start the server
app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
