// End-to-end test: tailor the resume to the Spydra "Blockchain Developer" JD.
//
// This JD demands Solidity and Web3.js — technologies Krishna's resume does NOT
// contain. His resume DOES have real blockchain work (Polygon, Ethereum smart
// contracts, IPFS, Merkle proofs). So the acceptance criteria are:
//   Guarantee 2 (no invented experience): "Solidity" and "Web3.js" must NOT
//     appear anywhere in the tailored output.
//   The AI may surface his real blockchain experience (that's legitimate).
//   Guarantee 1 (layout): the fixed template still renders all sections; no
//     new jobs/projects are added.
const { test, expect } = require('@playwright/test');
const { installRestore } = require('./_restore');

installRestore(test); // restore data/resume.json after these destructive tests

const SPYDRA_JD = `About the job
Company Overview
Spydra is a leading technology firm specializing in innovative blockchain solutions for the financial services and supply chain industries. Our Hyderabad office is a hub for cutting-edge development and deployment of decentralized applications.
Role Overview
As a Blockchain Developer at Spydra, you will design, develop, and deploy blockchain-based solutions for our clients.
Key Responsibilities
 Develop and implement smart contracts using Solidity for various blockchain platforms, ensuring code quality and security.
 Integrate front-end applications with blockchain networks using Web3.js, creating seamless user experiences.
 Design and implement secure and scalable blockchain architectures to meet client requirements.
 Conduct thorough testing and debugging of blockchain applications.
Required Skillset
 Proven ability to develop and deploy smart contracts using Solidity.
 Expertise in integrating front-end applications with blockchain networks using Web3.js.
 Strong understanding of blockchain architectures and security best practices.
 Bachelor's or Master's degree in Computer Science or a related field.`;

// Terms the resume does NOT contain — must never be invented into the output.
const FORBIDDEN = ['solidity', 'web3.js', 'web3js'];

test('tailoring to Spydra JD never invents Solidity/Web3.js and preserves layout', async ({ page }) => {
  // capture the tailor API response so we can assert on the real payload
  const tailorResponse = page.waitForResponse(
    (r) => r.url().includes('/api/tailor') && r.request().method() === 'POST'
  );

  await page.goto('/');

  // Modal must be hidden on load (regression guard for the earlier CSS bug).
  await expect(page.locator('#diffModal')).toBeHidden();

  // Paste the JD and tailor.
  await page.fill('#jd', SPYDRA_JD);
  await page.click('#tailorBtn');

  const resp = await tailorResponse;
  expect(resp.status(), 'tailor request should succeed').toBe(200);
  const data = await resp.json();
  const tailored = data.resume;

  // ---- Guarantee 2: no invented experience ----
  const flat = JSON.stringify(tailored).toLowerCase();
  for (const term of FORBIDDEN) {
    expect(flat, `"${term}" must NOT appear in tailored resume`).not.toContain(term);
  }

  // The AI SHOULD be able to keep his real blockchain experience visible.
  expect(flat, 'real blockchain experience should remain').toMatch(/polygon|ethereum|blockchain|ipfs/);

  // ---- Structure pinned: no new jobs/projects/skill categories ----
  expect(tailored.experience.length).toBe(1);
  expect(tailored.projects.length).toBe(2);
  expect(tailored.skills.length).toBe(8);
  // identity locked
  expect(tailored.name).toBe('KRISHNA SANAKA');
  expect(tailored.experience[0].company).toBe('Sapphirus Systems Pvt Ltd');
  expect(tailored.experience[0].dates).toBe('January 2024 – Present');

  // ---- Diff modal opens for review ----
  await expect(page.locator('#diffModal')).toBeVisible();

  // Apply, then confirm the live preview (real render engine) shows all sections
  // and still contains none of the forbidden terms — Guarantee 1 (layout intact).
  await page.click('#diffApply');
  await expect(page.locator('#diffModal')).toBeHidden();

  const previewText = (await page.frameLocator('#preview').locator('body').innerText()).toLowerCase();
  for (const section of ['professional summary', 'technical skills', 'key projects', 'education']) {
    expect(previewText, `preview should contain "${section}"`).toContain(section);
  }
  for (const term of FORBIDDEN) {
    expect(previewText, `preview must NOT contain "${term}"`).not.toContain(term);
  }

  // Log any guardrail violations the server reported (informational).
  if (data.violations && data.violations.length) {
    console.log('\nGuardrail violations reported by server:');
    data.violations.forEach((v) => console.log('  - ' + v));
  } else {
    console.log('\nNo guardrail violations (AI stayed within bounds on its own).');
  }
  console.log('\nTailored summary:\n  ' + tailored.summary);
});
