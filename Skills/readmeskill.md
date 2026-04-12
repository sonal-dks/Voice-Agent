---
name: github-readme-beginner
description: Generate a clear, beginner-friendly GitHub README.md for any project. Use this skill whenever the user wants to write or improve a README, push code to GitHub and needs documentation, or wants to explain their project to others — even if they don't use the word "README". Triggers on phrases like "document my project", "explain my code", "write a README", "push to GitHub", "help others understand my project", or "I want to share my project". Always use this skill when the user wants any kind of project documentation for GitHub.
---

# GitHub README Skill (Beginner-Friendly)

This skill helps Claude write warm, clear, beginner-friendly README files for any GitHub project — regardless of language or complexity.

---

## Goal

Produce a README.md that:
- Explains the project in plain English (no jargon assumed)
- Helps a complete beginner set up and run the project
- Looks professional and welcoming on GitHub
- Uses emojis sparingly for visual warmth (not clutter)

---

## Step 1 — Gather Context

Before writing, collect the following. Extract anything already mentioned in the conversation. Ask only for what's missing:

| Info | Example |
|---|---|
| **Project name** | `MyBudgetTracker` |
| **One-line description** | "A web app to track monthly expenses" |
| **Tech stack** | Python + Flask, or React + Node.js, etc. |
| **Main features** | List 3–5 things it does |
| **How to install / run** | `npm install`, `pip install -r requirements.txt`, etc. |
| **Any prerequisites** | Node.js 18+, Python 3.10+, a free API key, etc. |
| **Live demo or screenshots?** | Optional URL or image |
| **Who is the target user?** | Students, developers, general public, etc. |

If the user is unsure about any of these, help them figure it out or use sensible placeholders they can fill in later.

---

## Step 2 — Write the README

Use this structure. Adapt sections based on what applies to the project.

```markdown
# 🚀 [Project Name]

> One-line tagline that explains what the project does and who it's for.

![Optional screenshot or demo gif]

## 📖 What is this?

2–3 sentences. Explain the project like you're talking to a friend who doesn't code.
What problem does it solve? Why did you build it?

## ✨ Features

- Feature one (what it does, not how)
- Feature two
- Feature three

## 🛠️ Built With

- [Tech 1](link) — why you used it (optional)
- [Tech 2](link)

## ⚡ Getting Started

These instructions will help you run a copy of this project on your own computer.

### Prerequisites

What software does someone need before they begin?

```bash
# Example: Check if Node.js is installed
node --version
```

### Installation

Step-by-step. Number each step. Use code blocks for every command.

1. **Clone the repository**
   ```bash
   git clone https://github.com/your-username/project-name.git
   cd project-name
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**
   ```bash
   cp .env.example .env
   # Open .env and fill in your values
   ```

4. **Run the project**
   ```bash
   npm start
   ```

5. Open your browser and go to `http://localhost:3000`

## 🎮 How to Use

Show 1–2 common use cases with screenshots or short code examples.

## 📁 Project Structure (optional)

```
project-name/
├── src/          # Main source code
├── public/       # Static assets
├── tests/        # Test files
└── README.md
```

## 🤝 Contributing

Contributions are welcome! Here's how:

1. Fork the repo
2. Create a branch: `git checkout -b feature/your-feature`
3. Commit your changes: `git commit -m 'Add your feature'`
4. Push: `git push origin feature/your-feature`
5. Open a Pull Request

## 📝 License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.

## 🙋 Questions?

Have a question? [Open an issue](https://github.com/your-username/project-name/issues) or reach out at your@email.com.
```

---

## Writing Rules

### ✅ Always do this
- Use **numbered steps** for installation — never bullets
- Put **every terminal command in a code block**, even one-liners
- Explain **what each command does** in plain English before showing it
- Link to prerequisites (e.g., link "Node.js" to nodejs.org)
- Use **present tense**: "This app tracks..." not "This app will track..."
- Include a **Prerequisites section** even if it's just one thing

### ❌ Never do this
- Don't assume the reader knows what `npm`, `pip`, `clone`, etc. means — briefly explain on first use
- Don't skip the installation section even for simple projects
- Don't use phrases like "simply run" or "just do X" — beginners find this discouraging
- Don't leave placeholder text like `[your description here]` in the final output — use sensible defaults instead

---

## Tone Guide

| Too technical ❌ | Beginner-friendly ✅ |
|---|---|
| "Instantiate the server daemon" | "Start the server" |
| "Ensure ENV vars are hydrated" | "Add your API key to the `.env` file" |
| "Fork and submit a PR" | "Make a copy of the project (fork), make changes, then send them back (pull request)" |
| "Node >= 18 required" | "You'll need Node.js version 18 or higher — [download it here](https://nodejs.org)" |

---

## After Writing

1. **Ask the user to review** the Prerequisites and Installation sections — those are most likely to need tweaks
2. Remind them to:
   - Replace placeholder GitHub URLs with their real ones
   - Add actual screenshots if they have them
   - Update the license if it's not MIT
3. Offer to create a `LICENSE` file if they need one

---

## Quick Templates

### Minimal (scripts / small tools)
Skip: Contributing, Project Structure, How to Use
Keep: Description, Features, Installation, License

### Full (apps / products)
Use all sections. Add a **Roadmap** section if the project is ongoing.

### Library / Package
Add a **Usage** section with code examples showing how to import and use it.