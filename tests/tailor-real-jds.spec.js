// Data-driven end-to-end tests: tailor Krishna's resume to REAL job descriptions
// sourced from job boards (Dice, Indeed/Glassdoor templates) plus the user's
// Spydra posting. Each case asserts both guarantees through the real UI + engine:
//   - Guarantee 2: technologies the JD demands but the resume lacks are NEVER
//     invented into the output.
//   - Guarantee 1: the fixed template still renders every section; structure
//     (job/project/skill counts, identity) is pinned.
const { test, expect } = require('@playwright/test');
const { installRestore } = require('./_restore');

installRestore(test); // restore data/resume.json after these destructive tests

const CASES = [
  {
    name: 'Azure .NET Developer (Judge Group / Dice) — should MATCH & reword',
    forbidden: [], // his real stack — nothing should be blocked
    expectPresent: /\.net core|azure|rest api/i,
    jd: `Azure .Net Developer — Judge Group, Inc. — Greenwood Village, CO — Contract to Hire.
Candidate will provide expertise and ownership of Azure software development tasks within the scrum team.
Design, develop and maintain scalable backend services and RESTful APIs using .NET Core and C# in a cloud-native Microsoft Azure environment.
Collaborate closely with frontend developers, product owners, and DevOps engineers to deliver secure, reliable functionality.
Contribute to DevOps practices including version control, CI/CD pipelines via Azure DevOps, and monitoring.
Required: C#, .NET Core, Azure App Service, Azure Functions, Azure Service Bus, SQL Server, REST APIs, Git.`,
  },
  {
    name: 'Data Scientist / ML (Indeed template) — must NOT invent Python/Pandas/Hadoop',
    forbidden: ['python', 'pandas', 'numpy', 'hadoop', 'tensorflow', 'pytorch', 'scikit'],
    expectPresent: /\.net core|azure|node\.js/i,
    jd: `Data Scientist — Machine Learning.
Use statistical and machine learning techniques to analyze data and build predictive models.
Deploy, test, validate and maintain machine learning models in production.
Perform data cleaning, feature engineering, model selection and performance evaluation.
Required: Proficiency in Python for data analysis and modeling; Pandas and NumPy; big-data technologies such as Hadoop; strong knowledge of statistical analysis, data mining, and machine learning algorithms; experience with TensorFlow or PyTorch and scikit-learn.`,
  },
  {
    name: 'Blockchain Developer (Spydra) — must NOT invent Solidity/Web3.js',
    forbidden: ['solidity', 'web3.js', 'web3js'],
    expectPresent: /polygon|ethereum|blockchain|ipfs/i,
    jd: `Blockchain Developer — Spydra — Hyderabad.
Develop and implement smart contracts using Solidity for various blockchain platforms.
Integrate front-end applications with blockchain networks using Web3.js.
Design and implement secure and scalable blockchain architectures.
Required: Proven ability to develop and deploy smart contracts using Solidity; expertise integrating front-ends with blockchain networks using Web3.js; strong understanding of blockchain architectures and security best practices.`,
  },
  {
    name: 'DevOps / Kubernetes Engineer — must NOT invent Kubernetes/Terraform/Go',
    forbidden: ['kubernetes', 'terraform', 'helm', ' go ', 'golang', 'ansible', 'prometheus'],
    expectPresent: /docker|azure|ci\/cd/i,
    jd: `Senior DevOps Engineer.
Manage production Kubernetes clusters at scale and author infrastructure as code with Terraform and Helm.
Build and maintain observability with Prometheus and Grafana.
Write automation tooling in Go and Ansible playbooks.
Required: Kubernetes, Terraform, Helm, Go (Golang), Ansible, Prometheus; strong Linux and CI/CD background.`,
  },
];

for (const c of CASES) {
  test(c.name, async ({ page }) => {
    const tailorResponse = page.waitForResponse(
      (r) => r.url().includes('/api/tailor') && r.request().method() === 'POST'
    );

    await page.goto('/');
    await expect(page.locator('#diffModal')).toBeHidden();

    await page.fill('#jd', c.jd);
    await page.click('#tailorBtn');

    const resp = await tailorResponse;
    expect(resp.status(), 'tailor request should succeed').toBe(200);
    const data = await resp.json();
    const tailored = data.resume;

    // ---- Guarantee 2: no invented experience ----
    const flat = JSON.stringify(tailored).toLowerCase();
    for (const term of c.forbidden) {
      const t = term.trim();
      const re = new RegExp('\\b' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
      expect(re.test(flat), `"${t}" must NOT be invented in "${c.name}"`).toBe(false);
    }

    // real, relevant experience should survive
    expect(flat, 'relevant real experience should remain').toMatch(c.expectPresent);

    // ---- structure pinned ----
    expect(tailored.experience.length).toBe(1);
    expect(tailored.projects.length).toBe(2);
    expect(tailored.skills.length).toBe(8);
    expect(tailored.name).toBe('KRISHNA SANAKA');
    expect(tailored.experience[0].company).toBe('Sapphirus Systems Pvt Ltd');

    // ---- Guarantee 1: apply + preview renders full template, still clean ----
    await expect(page.locator('#diffModal')).toBeVisible();
    await page.click('#diffApply');
    await expect(page.locator('#diffModal')).toBeHidden();

    const preview = (await page.frameLocator('#preview').locator('body').innerText()).toLowerCase();
    for (const section of ['professional summary', 'technical skills', 'key projects', 'education']) {
      expect(preview, `preview should contain "${section}"`).toContain(section);
    }
    // word-boundary match so short terms like "go" don't false-match inside
    // ordinary words (e.g. "alongside"); escape regex metachars in the term.
    for (const term of c.forbidden) {
      const t = term.trim();
      const re = new RegExp('\\b' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
      expect(re.test(preview), `preview must NOT contain "${t}" (as a word)`).toBe(false);
    }

    // Did the AI actually change anything? (informational — shows tailoring works)
    const changed = data.violations || [];
    console.log(`\n[${c.name}]`);
    console.log('  tailored summary:', tailored.summary.slice(0, 140) + '…');
    console.log('  guardrail reverts:', changed.length);
  });
}
