import { chromium } from 'playwright'
import { mkdirSync } from 'fs'

const BASE = 'http://localhost:5000'
const DIR = 'screenshots/mobile'
mkdirSync(DIR, { recursive: true })

async function horizontalOverflow(page) {
  return page.evaluate(() => {
    const docW = document.documentElement.clientWidth
    const bad = []
    document.querySelectorAll('body *').forEach((el) => {
      const r = el.getBoundingClientRect()
      let inScroll = false
      let p = el.parentElement
      while (p && p !== document.body) {
        const ox = getComputedStyle(p).overflowX
        if (ox === 'auto' || ox === 'scroll') { inScroll = true; break }
        p = p.parentElement
      }
      if (!inScroll && r.width > 0 && (r.right > docW + 2 || r.left < -2)) {
        const cls = (el.className && el.className.toString) ? el.className.toString().slice(0, 40) : el.tagName
        bad.push(`${el.tagName}.${cls}`)
      }
    })
    return { docW, bad: bad.slice(0, 8) }
  })
}

async function shot(page, name) {
  await page.waitForTimeout(700)
  const ovf = await horizontalOverflow(page)
  await page.screenshot({ path: `${DIR}/${name}.png`, fullPage: true })
  console.log(`[shot] ${name}.png overflow=${ovf.bad.length}`, ovf.bad.length ? JSON.stringify(ovf.bad) : '')
}

;(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.PW_CHROME || '/root/.cache/ms-playwright/chromium-1161/chrome-linux/chrome',
    args: ['--no-sandbox'],
  })
  const ctx = await browser.newContext({
    viewport: { width: 375, height: 812 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  })
  const page = await ctx.newPage()
  const errs = []
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()) })
  page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message))

  await page.goto(BASE + '/login', { waitUntil: 'networkidle' })
  await shot(page, '01-login')

  // 一键测试登录：点击第一个快捷身份的「进入」按钮
  await page.getByRole('button', { name: '进入' }).first().click().catch(() => {})
  await page.waitForTimeout(2000)
  if (page.url().includes('/login')) {
    await page.locator('.ant-list-item').first().click().catch(() => {})
    await page.waitForTimeout(2000)
  }
  console.log('after login url:', page.url())

  await page.goto(BASE + '/', { waitUntil: 'networkidle' })
  await shot(page, '02-dashboard')

  await page.goto(BASE + '/jobs', { waitUntil: 'networkidle' })
  await shot(page, '03-jobs')

  await page.goto(BASE + '/todo', { waitUntil: 'networkidle' })
  await shot(page, '04-todo')

  await page.goto(BASE + '/orders', { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: /发单/ }).first().click().catch(() => {})
  await page.waitForTimeout(800)
  await shot(page, '05-order-create')
  await page.keyboard.press('Escape')

  await page.goto(BASE + '/msgs', { waitUntil: 'networkidle' })
  await shot(page, '06-msgs')

  await page.goto(BASE + '/ofds', { waitUntil: 'networkidle' })
  await shot(page, '07-ofds')

  await page.goto(BASE + '/master', { waitUntil: 'networkidle' })
  await shot(page, '08-master')

  // 工单详情（在工单列表页取链接）
  await page.goto(BASE + '/jobs', { waitUntil: 'networkidle' })
  await page.waitForTimeout(500)
  const firstJob = await page.evaluate(() => {
    const link = document.querySelector('a[href^="/job/"]')
    return link ? link.getAttribute('href') : null
  })
  if (firstJob) {
    await page.goto(BASE + firstJob, { waitUntil: 'networkidle' })
    await shot(page, '09-job-detail')
    await page.getByRole('button', { name: /进度/ }).first().click().catch(() => {})
    await page.waitForTimeout(700)
    await shot(page, '10-progress-modal')
    await page.keyboard.press('Escape')
  }

  // 履约单详情（交物/验收动线所在）
  await page.goto(BASE + '/ofds', { waitUntil: 'networkidle' })
  await page.waitForTimeout(400)
  const firstOfd = await page.evaluate(() => document.querySelector('a[href^="/ofd/"]')?.getAttribute('href') || null)
  if (firstOfd) {
    await page.goto(BASE + firstOfd, { waitUntil: 'networkidle' })
    await shot(page, '11-ofd-detail')
  }

  console.log('CONSOLE ERRORS:', errs.length ? JSON.stringify(errs.slice(0, 6)) : 'none')
  await browser.close()
})()
