# SmartSpend AI Procurement Copilot - Interactive Mockup Demo

This directory contains the high-fidelity, fully interactive React frontend mockup for the **SmartSpend AI Procurement Copilot** demonstration. It is built using **Vite**, **React (TypeScript)**, and **Tailwind CSS**.

---

## 🚀 How to Run the Demo Locally

Follow these steps to run the application on your local machine:

### 1. Prerequisites
Ensure you have **Node.js** (v18 or higher recommended) and **npm** installed:
```bash
node -v
npm -v
```

### 2. Install Dependencies
Navigate into this folder and install the required packages:
```bash
cd smartspend-demo
npm install
```

### 3. Start the Development Server
Run the Vite development server:
```bash
npm run dev
```

The terminal will display a local address (usually `http://localhost:5173/`). Open this link in your web browser.

### 4. Build for Production (Optional)
To package the app as static assets:
```bash
npm run build
```
This generates a production bundle in the `dist` folder.

---

## 🧪 Testing Script (12-Scene Walkthrough)

To verify the mockup, follow this step-by-step user path:

1. **Scene 1: Microsoft SSO Login**  
   * **Action:** Click "Employee Portal" or "Continue with Microsoft SSO" (simulate loading state).

2. **Scene 2: Dashboard Overview**  
   * **Action:** Review the metrics cards (Allocated Budget, MTD Spent, AI Savings, Rate Contracts). Click the **"Voice Procurement"** card.

3. **Scene 3: Voice Assistant Modal**  
   * **Action:** Click the microphone button to start recording. Wait for the soundwave animation, processing states, and converted text to appear. Click **"Continue"**.

4. **Scene 4: Parsed Request Form**  
   * **Action:** Review the parsed parameters (Product, Qty, Target Price, Category) and the resolved corporate addresses. Click **"Submit for Validation"**.

5. **Scene 5: Budget Validation**  
   * **Action:** View the cost center bar chart. Toggle **"Limit Exceeded"** to view AI-alternative choices (Budget Transfer, Split PO, CFO Exception). Click **"Proceed to Sourcing Check"**.

6. **Scene 6: Active Contract Search**  
   * **Action:** Toggle **"No"** to simulate having no pre-negotiated agreement. Click **"Launch Vendor Discovery"**.

7. **Scene 7: Sourcing & Discovery**  
   * **Action:** Review the external vendor catalog matches. Click **"Select & Compare"** for Primus Technologies.

8. **Scene 8: RFQ Value Scorecard**  
   * **Action:** Review the side-by-side evaluation matrix. Click **"Trigger AI Negotiation"**.

9. **Scene 9: AI Negotiation Lounge**  
   * **Action:** Click **"Start Agent Session"** and then **"Continue Negotiation"** step-by-step until the discount terms are locked. Click **"Route to Manager Approval"**.

10. **Scene 10: Manager Approval Panel**  
    * **Action:** Review the simplified inbox card showing negotiated savings. Click **"Approve Request"**.

11. **Scene 11: Amazon-Style Tracking**  
    * **Action:** Review the visual milestones timeline and underlying Odoo ERP document references (PR, RC, PO).

12. **Scene 12: CEO spend Analytics**  
    * **Action:** Use the **"DEMO STEP"** dropdown menu at the top center of the screen and choose "Scene 12" to inspect the corporate spend charts and fraud logs.
