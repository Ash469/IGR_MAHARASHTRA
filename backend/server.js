const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const automateForm = require('./automate');

const app = express();
const PORT = 3000;

// Global variables to store ongoing automation session
let activeSession = null;
let globalBrowser = null;
let globalPage = null;
let formState = {
  year: "2025",
  district: "",
  taluka: "",
  village: "",
  propertyNo: "",
  initialized: false,
  districts: [],
  talukas: [],
  villages: []
};

// Function to initialize the browser once
async function initializeBrowser() {
  if (globalBrowser) {
    console.log('Browser already initialized, reusing existing browser');
    return { browser: globalBrowser, page: globalPage };
  }
  
  console.log('Initializing new browser instance...');
  try {
    const browser = await puppeteer.launch({
      headless: false,
      defaultViewport: null,
      args: ['--start-maximized'],
      slowMo: 50
    });
    
    const page = await browser.newPage();
    
    // Navigate to the main site
    await page.goto('https://freesearchigrservice.maharashtra.gov.in/', {
      waitUntil: 'networkidle2',
      timeout: 60000
    });
    console.log('Website loaded successfully in persistent browser');
    
    // Handle popup first
    try {
      await page.waitForSelector('#popup .btnclose.btn.btn-danger', {
        visible: true,
        timeout: 5000
      });
      await Promise.all([
        page.click('#popup .btnclose.btn.btn-danger'),
        new Promise(resolve => setTimeout(resolve, 2000))
      ]);
      console.log('Popup closed successfully.');
    } catch (error) {
      console.log('No popup detected or already closed.');
    }
    
    // Click "Rest of Maharashtra" button
    console.log('Clicking on Rest of Maharashtra button...');
    await page.waitForSelector('#btnOtherdistrictSearch', {
      visible: true,
      timeout: 10000
    });
    
    await page.click('#btnOtherdistrictSearch');
    
    // Wait for the form to appear
    console.log('Waiting for form elements to appear...');
    await page.waitForSelector('#ddlFromYear1', {
      visible: true,
      timeout: 30000
    });
    
    // Additional wait for form to stabilize
    await new Promise(resolve => setTimeout(resolve, 3000));
    console.log('Rest of Maharashtra form loaded successfully.');
    
    globalBrowser = browser;
    globalPage = page;
    
    // Set up browser close handler
    browser.on('disconnected', () => {
      console.log('Browser was closed');
      globalBrowser = null;
      globalPage = null;
      formState.initialized = false;
    });
    
    return { browser, page };
  } catch (error) {
    console.error('Error initializing browser:', error);
    throw error;
  }
}

// Function to get all dropdown data in one go
async function getDropdownData(page) {
  try {
    // Get years
    const yearOptions = await page.evaluate(() => {
      const select = document.querySelector('#ddlFromYear1');
      return Array.from(select.options).map(o => ({
        value: o.value,
        text: o.text
      }));
    });
    console.log(`Found ${yearOptions.length} year options`);
    
    // Select year 2025
    await page.select('#ddlFromYear1', "2025");
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Get districts
    const districtOptions = await page.evaluate(() => {
      const select = document.querySelector('#ddlDistrict1');
      return Array.from(select.options).map(o => ({
        value: o.value,
        text: o.text
      }));
    });
    console.log(`Found ${districtOptions.length} district options`);
    
    return { 
      years: yearOptions,
      districts: districtOptions
    };
  } catch (error) {
    console.error('Error getting dropdown data:', error);
    throw error;
  }
}

// Function to get talukas for a district
async function getTalukas(page, district) {
  try {
    console.log(`Selecting district with value ${district}...`);
    await page.select('#ddlDistrict1', district);
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Wait for tahsil dropdown to be populated
    await Promise.all([
      page.waitForSelector('#ddltahsil', { visible: true }),
      page.waitForFunction(() => {
        const select = document.querySelector('#ddltahsil');
        return select && select.options.length > 1 && !select.disabled;
      }, { timeout: 15000 })
    ]);
    
    // Get available tahsil options
    const tahsilOptions = await page.evaluate(() => {
      const select = document.querySelector('#ddltahsil');
      return Array.from(select.options)
        .filter(option => option.value !== "---Select Tahsil----")
        .map(o => ({
          value: o.value.trim(),
          text: o.text
        }));
    });
    
    console.log(`Found ${tahsilOptions.length} taluka options for district ${district}`);
    return tahsilOptions;
  } catch (error) {
    console.error('Error getting talukas:', error);
    throw error;
  }
}

// Function to get villages for a taluka
async function getVillages(page, taluka) {
  try {
    console.log(`Selecting taluka with value ${taluka}...`);
    
    // First log all available options
    const availableTalukas = await page.evaluate(() => {
      const select = document.querySelector('#ddltahsil');
      return Array.from(select.options).map(o => ({
        value: o.value,
        text: o.text,
        index: o.index
      }));
    });
    console.log('Available taluka options:', availableTalukas);
    
    // Select the taluka
    const talukaResult = await page.evaluate((talukaValue) => {
      const select = document.querySelector('#ddltahsil');
      const options = Array.from(select.options);
      
      // Try exact match first
      let targetOption = options.find(o => o.value === talukaValue);
      
      // If not found, try with a space after (common issue)
      if (!targetOption) {
        targetOption = options.find(o => o.value === talukaValue + ' ');
      }
      
      // If still not found, try trimming spaces
      if (!targetOption) {
        targetOption = options.find(o => o.value.trim() === talukaValue);
      }
      
      // If found, select it
      if (targetOption) {
        select.selectedIndex = targetOption.index;
        select.value = targetOption.value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        return {
          success: true,
          selectedValue: targetOption.value,
          selectedText: targetOption.text
        };
      }
      return { success: false, message: "Option not found" };
    }, taluka);
    
    console.log('Taluka selection result:', talukaResult);
    
    // Wait for the selection to take effect
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // Wait for village dropdown to be populated
    console.log('Waiting for village dropdown to populate...');
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // Get village options
    const villageOptions = await page.evaluate(() => {
      const select = document.querySelector('#ddlvillage');
      return Array.from(select.options)
        .filter(option => option.value !== "---Select Village----")
        .map(o => ({
          value: o.value.trim(),
          text: o.text
        }));
    });
    
    console.log(`Found ${villageOptions.length} village options for taluka ${taluka}`);
    return villageOptions;
  } catch (error) {
    console.error('Error getting villages:', error);
    throw error;
  }
}

app.use(cors());
app.use(bodyParser.json());

// KEEP ORIGINAL CAPTCHA HANDLING
app.get('/captcha-image', (req, res) => {
  const captchaPath = path.join(__dirname, 'current-captcha.png');
  
  if (fs.existsSync(captchaPath)) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Expires', '-1');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Content-Type', 'image/png');
    res.sendFile(captchaPath);
  } else {
    console.error('CAPTCHA image not found at path:', captchaPath);
    res.status(404).send('CAPTCHA image not found');
  }
});

// KEEP ORIGINAL CAPTCHA STATUS
app.get('/captcha-status', (req, res) => {
  const captchaPath = path.join(__dirname, 'current-captcha.png');
  
  if (fs.existsSync(captchaPath)) {
    try {
      const stats = fs.statSync(captchaPath);
      res.json({
        exists: true,
        size: stats.size,
        modified: stats.mtime,
        path: captchaPath
      });
    } catch (err) {
      res.json({
        exists: true,
        error: err.message,
        path: captchaPath
      });
    }
  } else {
    res.json({
      exists: false,
      path: captchaPath
    });
  }
});

// KEEP ORIGINAL CAPTCHA SUBMISSION
app.post('/submit-captcha', async (req, res) => {
  const { captcha, closeBrowser } = req.body;
  
  if (!captcha || !captcha.trim()) {
    return res.json({ 
      success: false, 
      captchaRequired: true,
      message: 'Please enter the CAPTCHA value' 
    });
  }
  
  if (!activeSession) {
    return res.json({ 
      success: false, 
      message: 'No active session found, please start a new search' 
    });
  }
  
  try {
    console.log('Received CAPTCHA submission:', captcha);
    console.log('Keep browser open setting:', !closeBrowser);
    
    // Send the CAPTCHA value to the active automation session
    const result = await activeSession.submitCaptcha(captcha.trim());
    
    // Don't close the browser automatically
    result.browserKeptOpen = true;
    
    res.json(result);
  } catch (error) {
    console.error('Error processing CAPTCHA:', error);
    res.json({ 
      success: false, 
      message: `Error processing CAPTCHA: ${error.message}` 
    });
  }
});

// KEEP ORIGINAL SEARCH HANDLING
app.post('/search', async (req, res) => {
  const formData = req.body;
  const keepBrowserOpen = req.body.keepBrowserOpen === true;
  
  console.log('Keep browser open setting:', keepBrowserOpen);
  
  // Cancel any existing session
  if (activeSession && activeSession.cancel) {
    await activeSession.cancel();
  }
  
  try {
    const result = await automateForm({
      ...formData,
      keepBrowserOpen: true // Always keep browser open when searching
    });
    
    // If automation requires CAPTCHA
    if (result.captchaRequired) {
      activeSession = result.session; // Store session for later captcha submission
      
      return res.json({ 
        success: false, 
        captchaRequired: true,
        message: 'Please enter the CAPTCHA to continue' 
      });
    }
    
    res.json(result);
  } catch (error) {
    console.error('Error during search:', error);
    res.json({ 
      success: false, 
      message: `Error during search: ${error.message}` 
    });
  }
});

// Modified initialize endpoint using persistent browser
app.get('/initialize', async (req, res) => {
  try {
    // Use or create persistent browser
    const { browser, page } = await initializeBrowser();
    
    // If we already have the data cached, return it immediately
    if (formState.initialized && formState.districts.length > 0) {
      console.log('Using cached dropdown data');
      return res.json({
        success: true,
        years: formState.years,
        districts: formState.districts
      });
    }
    
    // Get all dropdown data
    const dropdownData = await getDropdownData(page);
    
    // Cache the data
    formState.years = dropdownData.years;
    formState.districts = dropdownData.districts;
    formState.initialized = true;
    
    // Return the data
    res.json({
      success: true,
      years: dropdownData.years,
      districts: dropdownData.districts
    });
    
  } catch (error) {
    console.error('Error initializing form:', error);
    
    // Fall back to original implementation if our new approach fails
    try {
      console.log('Falling back to original implementation');
      const result = await automateForm({ year: "2025" });
      res.json(result);
    } catch (fallbackError) {
      console.error('Fallback also failed:', fallbackError);
      res.status(500).json({ 
        success: false, 
        message: `Server error: ${error.message}, fallback error: ${fallbackError.message}`
      });
    }
    
    // Try to clean up on error
    if (globalBrowser) {
      try {
        await globalBrowser.close();
      } catch (e) {
        console.error('Error closing browser after initialization error:', e);
      }
      globalBrowser = null;
      globalPage = null;
      formState.initialized = false;
    }
  }
});

// Modified talukas endpoint using persistent browser
app.get('/talukas/:district', async (req, res) => {
  try {
    const { district } = req.params;
    
    // If the district hasn't changed and we have cached talukas, return them
    if (formState.district === district && formState.talukas.length > 0) {
      console.log(`Using cached talukas for district ${district}`);
      return res.json({
        success: true,
        talukas: formState.talukas
      });
    }
    
    // Use existing browser or initialize a new one
    const { page } = await initializeBrowser();
    
    // Get talukas for the district
    const talukas = await getTalukas(page, district);
    
    // Cache the results
    formState.district = district;
    formState.talukas = talukas;
    formState.village = ""; // Clear village when district changes
    formState.villages = [];
    
    // Return the talukas
    res.json({
      success: true,
      talukas: talukas
    });
    
  } catch (error) {
    console.error('Error fetching talukas:', error);
    
    // Fall back to original implementation
    try {
      console.log('Falling back to original implementation for talukas');
      const result = await automateForm({ 
        year: "2025",
        district: req.params.district
      });
      res.json(result);
    } catch (fallbackError) {
      console.error('Fallback also failed:', fallbackError);
      res.status(500).json({ 
        success: false, 
        message: `Server error: ${error.message}, fallback error: ${fallbackError.message}`
      });
    }
  }
});

// Modified villages endpoint using persistent browser
app.get('/villages/:district/:taluka', async (req, res) => {
  try {
    const { district, taluka } = req.params;
    
    // If the district and taluka haven't changed and we have cached villages, return them
    if (formState.district === district && formState.taluka === taluka && formState.villages.length > 0) {
      console.log(`Using cached villages for taluka ${taluka}`);
      return res.json({
        success: true,
        villages: formState.villages
      });
    }
    
    // Check if we need to select the district first
    if (formState.district !== district) {
      const { page } = await initializeBrowser();
      
      // First select the district
      await getTalukas(page, district);
      
      // Then get villages for the taluka
      const villages = await getVillages(page, taluka);
      
      // Cache the results
      formState.district = district;
      formState.taluka = taluka;
      formState.villages = villages;
      
      // Return the villages
      return res.json({
        success: true,
        villages: villages
      });
    } else {
      // District is already selected, just get villages
      const { page } = await initializeBrowser();
      
      // Get villages for the taluka
      const villages = await getVillages(page, taluka);
      
      // Cache the results
      formState.taluka = taluka;
      formState.villages = villages;
      
      // Return the villages
      return res.json({
        success: true,
        villages: villages
      });
    }
    
  } catch (error) {
    console.error('Error fetching villages:', error);
    
    // Fall back to original implementation
    try {
      console.log('Falling back to original implementation for villages');
      const result = await automateForm({ 
        year: "2025",
        district: req.params.district,
        taluka: req.params.taluka
      });
      res.json(result);
    } catch (fallbackError) {
      console.error('Fallback also failed:', fallbackError);
      res.status(500).json({ 
        success: false, 
        message: `Server error: ${error.message}, fallback error: ${fallbackError.message}`
      });
    }
  }
});

// Keep original full form submission endpoint
app.post('/automate', async (req, res) => {
  try {
    const formData = req.body;
    const result = await automateForm(formData);
    res.json(result);
  } catch (error) {
    console.error('Error processing form:', error);
    res.status(500).json({ 
      success: false, 
      message: `Server error: ${error.message}`
    });
  }
});

// Add endpoint to close browser
app.post('/close-browser', async (req, res) => {
  try {
    if (globalBrowser) {
      await globalBrowser.close();
      globalBrowser = null;
      globalPage = null;
      formState.initialized = false;
      
      console.log('Browser closed successfully');
      res.json({
        success: true,
        message: 'Browser closed successfully'
      });
    } else {
      res.json({
        success: true,
        message: 'No browser session to close'
      });
    }
  } catch (error) {
    console.error('Error closing browser:', error);
    res.json({
      success: false,
      message: `Error closing browser: ${error.message}`
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});