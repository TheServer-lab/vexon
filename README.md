# Vexon

**Vexon** is an experimental programming language and runtime focused on simplicity, control, and extensibility. It is designed to be approachable for experimentation while remaining powerful enough to build real tools, GUIs, and games.

Vexon prioritizes:
- A clean and readable syntax
- A hackable runtime and tooling ecosystem
- Optional GUI support via Electron
- Community-driven evolution

---

## 🚀 Getting Started

### Prerequisites

- **Node.js** (required)
- npm (included with Node.js)

### Installation

Clone the repository:

```bash
git clone https://github.com/<your-username>/vexon.git
cd vexon
```

Install dependencies:

```bash
npm install
```

### Running a Vexon file

```bash
vx example.vx
```

### Running GUI programs

GUI programs require Electron:

```bash
npm install electron --save-dev
```

Then run:

```bash
vx gui_example.vx
```

---

## 📦 Building GUI Apps

To build GUI-based Vexon applications:

```bash
npm install electron-builder --save-dev
```

Then use the Vexon compiler to package your app.

---

## 📚 Documentation

- Language syntax and examples: **See `/examples`**
- Runtime and core behavior: **See `/core`**
- GUI usage and demos: **See `/gui`**

More documentation will be added as the language evolves.

---

## 🤝 Contributing

Contributions are welcome and encouraged.

Before contributing, please read:

- [`CONTRIBUTING.md`](contributing.md)
- [`CODE_OF_CONDUCT.md`](code_of_conduct.md)

Ways you can help:
- Improve the language syntax or runtime
- Add examples or demos
- Fix bugs or improve stability
- Build tools, libraries, or GUIs using Vexon

---

## 🔐 Security

If you discover a security vulnerability, **please do not open a public issue**.

Instead, see:
- [`SECURITY.md`](SECURITY.md)

and report it privately via email.

---

## 📬 Contact

For questions, collaboration, or security reports:

📧 **vexonlang@outlook.com**

---

## 📜 License

Vexon is licensed under the **Vexon Open-Control License (VOCL)**.

See [`LICENSE`](LICENSE) for details.

---

## 🌱 Project Status

Vexon is under **active development**.

Breaking changes may occur between versions as the language and tooling mature. Feedback and experimentation are strongly encouraged.

