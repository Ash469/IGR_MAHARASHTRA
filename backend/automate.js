const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

// Update the saveUrlToJson function to fix the issue
function saveUrlToJson(url) {
    try {
        let data = [];
        const filePath = 'data.json';
        
        // Check if file exists and read its content
        if (fs.existsSync(filePath)) {
            try {
                const fileContent = fs.readFileSync(filePath, 'utf8');
                if (fileContent && fileContent.trim() !== '') {
                    data = JSON.parse(fileContent);
                }
            } catch (error) {
                console.error('Error parsing existing data.json:', error.message);
                // If error, start with empty array
                data = [];
            }
        }
        
        // Make sure data is an array
        if (!Array.isArray(data)) {
            data = [];
        }
        
        // Add new URL to the array
        data.push({ 
            url: url, 
            timestamp: new Date().toISOString() 
        });
        
        // Write back to file with formatting
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
        console.log(`Saved URL to data.json: ${url}`);
        return true;
    } catch (error) {
        console.error('Error saving URL to data.json:', error.message);
        return false;
    }
}

async function automateForm(formData = {}) {
    // Extract form values or use defaults
    const year = formData.year || "2025";
    const district = formData.district || "";
    const taluka = formData.taluka || "";
    const village = formData.village || "";
    const propertyNo = formData.propertyNo || "";
    const captcha = formData.captcha || "";
    const keepBrowserOpen = formData.keepBrowserOpen === true;

    // Initialize result object to store dropdown data
    const result = {
        years: [],
        districts: [],
        talukas: [],
        villages: [],
        propertyData: null,
        success: false,
        message: '',
        captchaRequired: false
    };

    console.log(`Starting automation with parameters:`, {
        year, district, taluka, village, propertyNo, captcha, keepBrowserOpen
    });

    console.log('Launching the browser...');
    const browser = await puppeteer.launch({
        headless: false,
        defaultViewport: null,
        args: ['--start-maximized'],
        slowMo: 50 // Add slight delay between actions
    });
    const page = await browser.newPage();
    console.log('Browser launched successfully.');

    // Store document page URLs
    let documentUrls = [];
    
    // Update the event listener for new pages
    browser.on('targetcreated', async (target) => {
        try {
            // Wait for the new page to load
            const newPage = await target.page();
            if (newPage) {
                try {
                    // Wait for the page to load
                    await newPage.waitForNavigation({ timeout: 5000 }).catch(() => {});
                    
                    try {
                        // Now get the URL of the new page
                        const url = await newPage.url();
                        console.log(`New page created with URL: ${url}`);
                        
                        // Check if it's a document URL
                        if (url.includes('.aspx')) {
                            console.log(`Found document URL: ${url}`);
                            
                            // Create base documents folder if it doesn't exist
                            if (!fs.existsSync('documents')) {
                                fs.mkdirSync('documents');
                            }
                            
                            // Create village-specific folder
                            const villageFolderName = formData.village.replace(/[\/\\?%*:|"<>]/g, '-').trim() || 'unknown-village';
                            const villageFolder = path.join('documents', villageFolderName);
                            
                            if (!fs.existsSync(villageFolder)) {
                                fs.mkdirSync(villageFolder);
                                console.log(`Created folder for village: ${villageFolderName}`);
                            }
                            
                            // Wait a moment for content to fully load
                            await new Promise(resolve => setTimeout(resolve, 2000));
                            
                            // Save as PDF in the village folder
                            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                            const pdfPath = path.join(villageFolder, `document-auto-${timestamp}.pdf`);
                            
                            console.log(`Saving document as PDF: ${pdfPath}`);
                            await newPage.pdf({
                                path: pdfPath,
                                format: 'A4',
                                printBackground: true
                            });
                            
                            console.log(`Successfully saved PDF: ${pdfPath}`);
                            
                            // Don't close the page - let user view it
                        }
                    } catch (err) {
                        console.log(`Error getting URL from new page: ${err.message}`);
                    }
                } catch (err) {
                    console.log(`Error with navigation: ${err.message}`);
                }
            }
        } catch (err) {
            console.log(`Error handling new target: ${err.message}`);
        }
    });

    // Set up session interface for handling CAPTCHA
    const session = {
        browser,
        page,
        submitCaptcha: async (captchaValue) => {
            console.log(`Submitting CAPTCHA from frontend: ${captchaValue}`);
            try {
                // Enter captcha value in the CORRECT field (#txtImg1 instead of #txtCaptcha)
                await page.evaluate((value) => {
                    const input = document.querySelector('#txtImg1');
                    if (input) {
                        input.value = value;
                        input.dispatchEvent(new Event('input', { bubbles: true }));
                        input.dispatchEvent(new Event('change', { bubbles: true }));
                    } else {
                        console.error('CAPTCHA input field #txtImg1 not found');
                        throw new Error('CAPTCHA input field #txtImg1 not found');
                    }
                }, captchaValue);

                console.log('CAPTCHA value entered successfully');

                // Click the correct search button
                console.log('Clicking search button...');
                await page.evaluate(() => {
                    const searchButton = document.querySelector('#btnSearch_RestMaha');
                    if (searchButton) {
                        searchButton.click();
                        return true;
                    }

                    // Fallback if button not found
                    const possibleButtons = [
                        '#btnSearch_RestMaha',
                        '#btnSearch',
                        'input[type="button"][value="Search"]',
                        'button[type="submit"]',
                        'input[type="submit"]'
                    ];

                    for (const selector of possibleButtons) {
                        const btn = document.querySelector(selector);
                        if (btn) {
                            btn.click();
                            return true;
                        }
                    }

                    throw new Error('Search button not found on the page');
                });

                console.log('Search button clicked, waiting for results...');

                // Wait for search results to load
                await new Promise(resolve => setTimeout(resolve, 5000));

                // Check if there's an error message indicating invalid captcha
                const invalidCaptcha = await page.evaluate(() => {
                    const errorElement = document.querySelector('.error-message, #lblError');
                    return errorElement &&
                        (errorElement.textContent.includes('invalid') ||
                            errorElement.textContent.includes('CAPTCHA'));
                });

                if (invalidCaptcha) {
                    // If invalid, download the new captcha image and require another attempt
                    await downloadCaptchaImage(page);
                    return {
                        success: false,
                        captchaRequired: true,
                        message: 'Invalid CAPTCHA. Please try again.',
                        browserKeptOpen: true
                    };
                }

                // If successful, scrape and return the property data
                const propertyData = await scrapePropertyData(page);
                return {
                    success: true,
                    propertyData,
                    message: 'Search completed successfully',
                    browserKeptOpen: true // Indicate that browser is kept open
                };

            } catch (error) {
                console.error('Error processing CAPTCHA:', error);
                return {
                    success: false,
                    message: `Error processing CAPTCHA: ${error.message}`,
                    captchaRequired: true,
                    browserKeptOpen: true
                };
            }
        },
        cancel: async () => {
            try {
                await browser.close();
                console.log('Automation session cancelled');
                return { success: true, message: 'Session cancelled' };
            } catch (error) {
                console.error('Error cancelling session:', error);
                return { success: false, message: `Error cancelling session: ${error.message}` };
            }
        }
    };

    try {
        // Enable request interception
        await page.setRequestInterception(true);
        page.on('request', request => request.continue());
        page.on('response', async response => {
            if (response.url().includes('freesearchigrservice.maharashtra.gov.in')) {
                console.log(`Network response received: ${response.status()}`);
            }
        });

        // Navigate to the website
        console.log('Navigating to the website...');
        await page.goto('https://freesearchigrservice.maharashtra.gov.in/', {
            waitUntil: 'networkidle2',
            timeout: 60000 // Increased timeout
        });
        console.log('Website loaded successfully.');

        // Handle popup first
        console.log('Checking for popups...');
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

        // Click "Rest of Maharashtra" button with better handling
        console.log('Clicking on Rest of Maharashtra button...');
        await page.waitForSelector('#btnOtherdistrictSearch', {
            visible: true,
            timeout: 10000
        });

        // Ensure button is clickable
        await page.waitForFunction(() => {
            const button = document.querySelector('#btnOtherdistrictSearch');
            return button && button.offsetParent !== null;
        }, { timeout: 10000 });

        // Click without waiting for navigation event
        console.log('Clicking button and waiting for form to load...');
        await page.click('#btnOtherdistrictSearch');

        // Wait for the form to appear instead of navigation
        console.log('Waiting for form elements to appear...');
        await page.waitForSelector('#ddlFromYear1', {
            visible: true,
            timeout: 30000
        });

        // Additional wait for form to stabilize
        await new Promise(resolve => setTimeout(resolve, 3000));

        console.log('Rest of Maharashtra form loaded successfully.');

        // Proceed directly to year selection
        console.log('Proceeding to year selection...');
        try {
            // Ensure the year dropdown is populated
            await page.waitForFunction(() => {
                const yearSelect = document.querySelector('#ddlFromYear1');
                return yearSelect && yearSelect.options.length > 0;
            }, { timeout: 15000 });

            // Get available years options
            const yearOptions = await page.evaluate(() => {
                const select = document.querySelector('#ddlFromYear1');
                return Array.from(select.options).map(o => ({
                    value: o.value,
                    text: o.text
                }));
            });

            console.log('Year dropdown options:', yearOptions);
            // Store years for frontend
            result.years = yearOptions;

            // Select year
            console.log(`Selecting year ${year}...`);
            await page.select('#ddlFromYear1', year);

            // Wait for selection to take effect
            await new Promise(resolve => setTimeout(resolve, 3000));

            // Continue with district selection
            console.log('Handling district selection...');
            await Promise.all([
                page.waitForSelector('#ddlDistrict1', { visible: true }),
                page.waitForFunction(() => {
                    const select = document.querySelector('#ddlDistrict1');
                    return select && select.options.length > 1 && !select.disabled;
                }, { timeout: 15000 })
            ]);

            // Get available district options
            const districtOptions = await page.evaluate(() => {
                const select = document.querySelector('#ddlDistrict1');
                return Array.from(select.options).map(o => ({
                    value: o.value,
                    text: o.text
                }));
            });

            console.log('District dropdown options:', districtOptions);
            // Store districts for frontend
            result.districts = districtOptions;

            // If no specific district selected, just return the available options
            if (!district) {
                result.success = true;
                result.message = 'Retrieved available districts';

                // Only close browser if not explicitly keeping it open
                if (!keepBrowserOpen) {
                    await browser.close();
                } else {
                    console.log('Keeping browser open as requested');
                    result.browserKeptOpen = true;
                }

                return result;
            }

            // Select district with the provided value
            console.log(`Selecting district with value ${district}...`);
            await page.select('#ddlDistrict1', district);
            await new Promise(resolve => setTimeout(resolve, 3000));

            // Wait for tahsil dropdown to be populated
            console.log('Handling tahsil selection...');
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
                    .filter(option => option.value !== "---Select Tahsil----") // Filter out placeholder
                    .map(o => ({
                        value: o.value.trim(),
                        text: o.text
                    }));
            });

            console.log('Tahsil dropdown options (filtered):', tahsilOptions);
            // Store talukas for frontend
            result.talukas = tahsilOptions;

            // If no specific taluka selected, just return the available options
            if (!taluka || taluka === "---Select Tahsil----") {
                result.success = true;
                result.message = 'Retrieved available talukas';

                // Only close browser if not explicitly keeping it open
                if (!keepBrowserOpen) {
                    await browser.close();
                } else {
                    console.log('Keeping browser open as requested');
                    result.browserKeptOpen = true;
                }

                return result;
            }

            // Select taluka with the provided value
            console.log(`Selecting taluka with value ${taluka}...`);

            // Log all available options for debugging first
            const availableTalukas = await page.evaluate(() => {
                const select = document.querySelector('#ddltahsil');
                return Array.from(select.options).map(o => ({
                    value: o.value,
                    text: o.text,
                    index: o.index
                }));
            });
            console.log('Available taluka options with exact values:', availableTalukas);

            // Look for the option with the given value, accounting for spaces
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
                    // First reset selection to ensure change event triggers
                    select.selectedIndex = 0;

                    // Then set our selection
                    select.selectedIndex = targetOption.index;
                    select.value = targetOption.value; // Also set by value for good measure

                    // Create and dispatch events
                    select.dispatchEvent(new Event('focus', { bubbles: true }));
                    select.dispatchEvent(new Event('change', { bubbles: true }));
                    select.dispatchEvent(new Event('blur', { bubbles: true }));

                    // Return selection info
                    return {
                        success: true,
                        selectedValue: targetOption.value,
                        selectedText: targetOption.text,
                        selectedIndex: targetOption.index
                    };
                }

                return {
                    success: false,
                    message: "Option not found"
                };
            }, taluka);

            console.log('Taluka selection attempt result:', talukaResult);

            // Wait for the selection to take effect
            await new Promise(resolve => setTimeout(resolve, 5000));

            // Verify if selection was successful
            const verifySelection = await page.evaluate(() => {
                const select = document.querySelector('#ddltahsil');
                return {
                    selectedIndex: select.selectedIndex,
                    selectedValue: select.value,
                    selectedText: select.options[select.selectedIndex].text
                };
            });

            console.log('Current taluka selection after attempt:', verifySelection);

            // If selection still failed, try direct DOM manipulation
            if (verifySelection.selectedIndex === 0 || verifySelection.selectedValue === "---Select Tahsil----") {
                console.log('Selection still failed, trying direct script injection...');

                await page.evaluate((talukaValue) => {
                    // This executes direct JavaScript in the page context
                    try {
                        // Try to find the exact option first
                        const select = document.querySelector('#ddltahsil');
                        const options = Array.from(select.options);

                        // Try various matching methods
                        let targetOption = null;
                        let targetIndex = -1;

                        // Try exact match
                        targetIndex = options.findIndex(o => o.value === talukaValue);

                        // Try with space after
                        if (targetIndex < 0) {
                            targetIndex = options.findIndex(o => o.value === talukaValue + ' ');
                        }

                        // Try trimmed match
                        if (targetIndex < 0) {
                            targetIndex = options.findIndex(o => o.value.trim() === talukaValue);
                        }

                        // Try starts with match
                        if (targetIndex < 0) {
                            targetIndex = options.findIndex(o => o.value.trim().startsWith(talukaValue));
                        }

                        if (targetIndex > 0) { // Skip index 0 which is the placeholder
                            console.log(`Found matching option at index ${targetIndex}`);

                            // Use JavaScript to force change the dropdown
                            select.selectedIndex = targetIndex;

                            // Force a change event
                            const event = new Event('change', { bubbles: true });
                            select.dispatchEvent(event);

                            // Also try to trigger change handlers directly
                            if (typeof jQuery !== 'undefined') {
                                jQuery(select).trigger('change');
                            }

                            return {
                                success: true,
                                message: `Selected option at index ${targetIndex}`,
                                value: select.value,
                                text: select.options[select.selectedIndex].text
                            };
                        }

                        return {
                            success: false,
                            message: 'No matching option found'
                        };
                    } catch (error) {
                        return {
                            success: false,
                            message: `Error: ${error.message}`
                        };
                    }
                }, taluka);

                // Wait again after this attempt
                await new Promise(resolve => setTimeout(resolve, 5000));

                // Final verification
                const finalVerify = await page.evaluate(() => {
                    const select = document.querySelector('#ddltahsil');
                    return {
                        selectedIndex: select.selectedIndex,
                        selectedValue: select.value,
                        selectedText: select.options[select.selectedIndex].text
                    };
                });

                console.log('Final taluka selection status:', finalVerify);
            }

            await new Promise(resolve => setTimeout(resolve, 3000));

            // Verify taluka selection succeeded
            const talukaSelectedVerification = await page.evaluate((expectedTaluka) => {
                const select = document.querySelector('#ddltahsil');
                const selectedOption = select.options[select.selectedIndex];
                return {
                    success: selectedOption &&
                        (selectedOption.value.trim() === expectedTaluka.trim() ||
                            selectedOption.text.trim().toLowerCase() === expectedTaluka.trim().toLowerCase()),
                    selectedValue: selectedOption ? selectedOption.value : '',
                    selectedText: selectedOption ? selectedOption.text : ''
                };
            }, taluka);

            if (!talukaSelectedVerification.success) {
                console.log(`Taluka selection may have failed. Expected: "${taluka}", Selected: "${talukaSelectedVerification.selectedValue}" (${talukaSelectedVerification.selectedText})`);
            } else {
                console.log(`Taluka selected successfully: "${talukaSelectedVerification.selectedText}" (${talukaSelectedVerification.selectedValue})`);
            }

            // Wait for village dropdown to be populated
            console.log('Waiting for village dropdown to populate...');
            await new Promise(resolve => setTimeout(resolve, 5000)); // Give ample time for villages to load

            // Get village options
            const villageOptions = await page.evaluate(() => {
                const select = document.querySelector('#ddlvillage');
                return Array.from(select.options).map(o => ({
                    value: o.value.trim(),
                    text: o.text
                }));
            });

            console.log(`Village dropdown has ${villageOptions.length} options`);

            // Store villages for frontend
            result.villages = villageOptions.filter(v => v.value !== "---Select Village----");

            // If no specific village or property number, just return the available options
            if (!village || !propertyNo) {
                result.success = true;
                result.message = 'Retrieved available villages';

                // Only close browser if not explicitly keeping it open
                if (!keepBrowserOpen) {
                    await browser.close();
                } else {
                    console.log('Keeping browser open as requested');
                    result.browserKeptOpen = true;
                }

                return result;
            }

            // Select village with the provided value
            console.log(`Selecting village with value "${village}"...`);
            const villageSelected = await page.evaluate(async (villageValue) => {
                const select = document.querySelector('#ddlvillage');

                // Log all available options for debugging
                const allOptions = Array.from(select.options).map(o => ({
                    value: o.value.trim(),
                    text: o.text
                }));
                console.log("Available village options:", JSON.stringify(allOptions));

                // Try direct selection first
                select.value = villageValue;
                select.dispatchEvent(new Event('change'));

                // Wait a bit for the change event to process
                await new Promise(resolve => setTimeout(resolve, 1000));

                // Check if selection worked
                if (select.value === villageValue) {
                    console.log(`Successfully selected village with value: ${villageValue}`);
                    return {
                        success: true,
                        method: "direct",
                        value: select.value,
                        text: select.options[select.selectedIndex].text
                    };
                }

                // If direct selection failed, try finding the option by exact value match
                const option = Array.from(select.options).find(o => o.value.trim() === villageValue.trim());
                if (option) {
                    console.log(`Found matching option by exact value: ${option.text} (${option.value})`);
                    select.value = option.value;
                    select.dispatchEvent(new Event('change'));

                    // Wait a bit for the change event to process
                    await new Promise(resolve => setTimeout(resolve, 1000));

                    return {
                        success: true,
                        method: "value",
                        value: select.value,
                        text: select.options[select.selectedIndex].text
                    };
                }

                // Try by exact text match
                const textOption = Array.from(select.options).find(o =>
                    o.text.trim() === villageValue.trim()
                );

                if (textOption) {
                    console.log(`Found matching option by exact text: ${textOption.text} (${textOption.value})`);
                    select.value = textOption.value;
                    select.dispatchEvent(new Event('change'));

                    // Wait a bit for the change event to process
                    await new Promise(resolve => setTimeout(resolve, 1000));

                    return {
                        success: true,
                        method: "text",
                        value: select.value,
                        text: select.options[select.selectedIndex].text
                    };
                }

                // Try by partial match (case insensitive)
                const partialOption = Array.from(select.options).find(o =>
                    o.text.trim().toLowerCase().includes(villageValue.trim().toLowerCase()) ||
                    villageValue.trim().toLowerCase().includes(o.text.trim().toLowerCase())
                );

                if (partialOption) {
                    console.log(`Found matching option by partial text: ${partialOption.text} (${partialOption.value})`);
                    select.value = partialOption.value;
                    select.dispatchEvent(new Event('change'));

                    // Wait a bit for the change event to process
                    await new Promise(resolve => setTimeout(resolve, 1000));

                    return {
                        success: true,
                        method: "partial",
                        value: select.value,
                        text: select.options[select.selectedIndex].text
                    };
                }

                // If all else fails, select the first non-placeholder option
                const options = Array.from(select.options).filter(o => o.value !== "---Select Village----");
                if (options.length > 0) {
                    console.log(`No match found. Selecting first available village: ${options[0].text} (${options[0].value})`);
                    select.value = options[0].value;
                    select.dispatchEvent(new Event('change'));

                    // Wait a bit for the change event to process
                    await new Promise(resolve => setTimeout(resolve, 1000));

                    return {
                        success: true,
                        method: "fallback",
                        value: select.value,
                        text: select.options[select.selectedIndex].text
                    };
                }

                return { success: false, availableOptions: allOptions };
            }, village);

            console.log('Village selection result:', villageSelected);

            // Wait for selection to take effect
            await new Promise(resolve => setTimeout(resolve, 3000));

            // Get final selected village for verification
            const finalSelectedVillage = await page.evaluate(() => {
                const select = document.querySelector('#ddlvillage');
                return {
                    value: select.value,
                    text: select.options[select.selectedIndex].text
                };
            });

            console.log(`Final selected village: ${finalSelectedVillage.text} (${finalSelectedVillage.value})`);

            // Skip the previous "select 3rd village" code and use our proper selection
            console.log('Using selected village value for search...');
            await page.click('#ddlvillage');
            await new Promise(resolve => setTimeout(resolve, 1000));

            console.log('Continuing with property number entry...');

            // Enter property number
            await page.type('#txtAttributeValue1', '');
            console.log('Property number entered: 3');

            // After filling all the form fields and property number
            if (propertyNo) {
                await page.type('#txtAttributeValue1', propertyNo);

                // Wait for CAPTCHA to become visible
                await page.waitForSelector('#imgCaptcha_new', { visible: true });

                // Download the CAPTCHA image
                await handleCaptcha(page, browser);

                // Return early, indicating we need a CAPTCHA
                result.captchaRequired = true;
                result.session = session;
                result.message = 'Please enter the CAPTCHA to continue';
                return result;
            }

            async function handleCaptcha() {
                try {
                    // Get the current CAPTCHA image element
                    const captchaImage = await page.$('#imgCaptcha_new');

                    if (!captchaImage) {
                        console.error('CAPTCHA image element not found');
                        return false;
                    }

                    // Get the complete image URL
                    const captchaUrl = await page.evaluate(img => img.src, captchaImage);
                    console.log('Found CAPTCHA URL:', captchaUrl);

                    // Make sure we have a valid URL
                    if (!captchaUrl || !captchaUrl.includes('txt=')) {
                        console.error('Invalid CAPTCHA URL format:', captchaUrl);

                        // Take a screenshot of the CAPTCHA for manual input
                        const captchaBox = await captchaImage.boundingBox();
                        const screenshot = await page.screenshot({
                            clip: {
                                x: captchaBox.x,
                                y: captchaBox.y,
                                width: captchaBox.width,
                                height: captchaBox.height
                            }
                        });

                        // Save the screenshot
                        const fs = require('fs').promises;
                        const path = require('path');
                        const imagePath = path.join(__dirname, 'current-captcha.png');
                        await fs.writeFile(imagePath, screenshot);
                        console.log(`CAPTCHA screenshot saved to: ${imagePath}`);
                    } else {
                        // Extract the dynamic parameter and download
                        const txtParam = captchaUrl.split('txt=')[1];
                        const fs = require('fs').promises;
                        const path = require('path');

                        try {
                            // Use page.goto to download the image to avoid SSL certificate issues
                            const tempPage = await browser.newPage();
                            await tempPage.setRequestInterception(true);

                            let imageBuffer = null;

                            tempPage.on('request', request => {
                                request.continue();
                            });

                            tempPage.on('response', async response => {
                                if (response.url().includes('Handler.ashx?txt=')) {
                                    imageBuffer = await response.buffer();
                                }
                            });

                            // Navigate to CAPTCHA URL
                            await tempPage.goto(`https://freesearchigrservice.maharashtra.gov.in/Handler.ashx?txt=${txtParam}`, {
                                waitUntil: 'networkidle0',
                                timeout: 10000
                            });

                            if (imageBuffer) {
                                // Save the CAPTCHA image
                                const imagePath = path.join(__dirname, 'current-captcha.png');
                                await fs.writeFile(imagePath, imageBuffer);
                                console.log(`CAPTCHA image saved to: ${imagePath}`);
                            }

                            // Close the temporary page
                            await tempPage.close();
                        } catch (error) {
                            console.error('Error downloading CAPTCHA with browser:', error.message);

                            // Fallback: Take screenshot of the CAPTCHA
                            const captchaBox = await captchaImage.boundingBox();
                            const screenshot = await page.screenshot({
                                clip: {
                                    x: captchaBox.x,
                                    y: captchaBox.y,
                                    width: captchaBox.width,
                                    height: captchaBox.height
                                }
                            });

                            // Save the screenshot
                            const imagePath = path.join(__dirname, 'current-captcha.png');
                            await fs.writeFile(imagePath, screenshot);
                            console.log(`CAPTCHA screenshot saved as fallback: ${imagePath}`);
                        }
                    }

                    // Get CAPTCHA input from terminal
                    const captchaValue = await askForCaptchaInTerminal();

                    console.log(captchaValue);

                    // Enter CAPTCHA
                    await page.evaluate((value) => {
                        const input = document.querySelector('#txtImg1');
                        if (input) {
                            input.value = value;
                            input.dispatchEvent(new Event('input', { bubbles: true }));
                            input.dispatchEvent(new Event('change', { bubbles: true }));
                        }
                    }, captchaValue.trim());

                    // Submit form
                    console.log('Submitting the form...');
                    await page.click('#btnSearch_RestMaha');

                    // Use setTimeout instead of waitForTimeout
                    await new Promise(resolve => setTimeout(resolve, 5000));

                    return true;
                } catch (error) {
                    console.error('Error in CAPTCHA handling:', error.message);
                    return false;
                }
            }

            // Handle CAPTCHA just once
            console.log('Processing CAPTCHA...');
            const captchaSuccess = await handleCaptcha();

            if (captchaSuccess) {
                console.log('Form submitted successfully.');

                // INCREASE THE DELAY: Give much more time for the page to load after CAPTCHA submission
                console.log('Waiting for page to process after submission...');
                await new Promise(resolve => setTimeout(resolve, 45000)); // Increased from 30000 to 45000 ms (45 seconds)

                // Wait for results page to load with extra checks
                console.log('Checking if page is fully loaded...');
                try {
                    // First check if document is complete
                    await page.waitForFunction(() => document.readyState === 'complete', { timeout: 10000 })
                        .catch(() => console.log('Page load completion check timed out, continuing anyway'));
                    
                    console.log('Page load state is complete, checking for network activity...');
                    
                    // Wait for network to be idle
                    await new Promise(resolve => setTimeout(resolve, 5000));
                    
                    // Now actively wait for IndexII buttons with retry mechanism
                    console.log('Checking for IndexII buttons in tables...');
                    let indexButtons = [];
                    let retryCount = 0;
                    const maxRetries = 3;
                    
                    while (retryCount < maxRetries) {
                        // Look for all input buttons with value "IndexII" within table rows
                        indexButtons = await page.evaluate(() => {
                            // Find all input buttons with value "IndexII"
                            const buttons = Array.from(document.querySelectorAll('input[type="button"][value="IndexII"]'));
                            
                            if (buttons.length === 0) {
                                console.log('No IndexII buttons found yet, may still be loading...');
                            }

                            // Return information about each button for logging
                            return buttons.map((button, index) => {
                                // Find the closest table row for context
                                const row = button.closest('tr');
                                let rowText = '';

                                if (row) {
                                    // Get text from the first few cells in the row for identification
                                    const cells = Array.from(row.querySelectorAll('td')).slice(0, 3);
                                    rowText = cells.map(cell => cell.innerText.trim()).join(' | ');
                                }

                                return {
                                    index,
                                    rowText,
                                    found: true
                                };
                            });
                        });

                        console.log(`Found ${indexButtons.length} IndexII buttons (attempt ${retryCount + 1} of ${maxRetries})`);
                        
                        // If we found buttons, break the retry loop
                        if (indexButtons.length > 0) {
                            console.log('Successfully found IndexII buttons');
                            break;
                        }
                        
                        // Otherwise, wait and retry
                        console.log(`No IndexII buttons found yet, waiting longer (attempt ${retryCount + 1} of ${maxRetries})...`);
                        await new Promise(resolve => setTimeout(resolve, 15000)); // Wait 15 seconds between retries
                        retryCount++;
                        
                        // On final retry, take a screenshot for debugging
                        if (retryCount === maxRetries - 1) {
                            console.log('Taking screenshot of current page state before final check...');
                            await page.screenshot({ path: 'before-final-indexii-check.png', fullPage: true });
                            
                            // Also verify the page content
                            const pageContent = await page.content();
                            const hasIndexIIText = pageContent.includes('IndexII');
                            console.log(`Page contains 'IndexII' text: ${hasIndexIIText}`);
                        }
                    }

                    if (indexButtons.length > 0) {
                        console.log('IndexII buttons found in these rows:');
                        indexButtons.forEach(btn => {
                            console.log(`Button ${btn.index + 1}: ${btn.rowText}`);
                        });

                        // Process each button one by one
                        for (let i = 0; i < indexButtons.length; i++) {
                            console.log(`Clicking on IndexII button ${i + 1} of ${indexButtons.length}...`);

                            // Check if we're on the results page
                            const backToResultsPage = async () => {
                                try {
                                    // Check if we're on the results page
                                    const isOnResultsPage = await page.evaluate(() => {
                                        return document.querySelectorAll('input[type="button"][value="IndexII"]').length > 0;
                                    });
                                    
                                    if (!isOnResultsPage) {
                                        console.log('Navigating back to results page...');
                                        await page.goBack();
                                        await new Promise(resolve => setTimeout(resolve, 5000));
                                        
                                        // Verify we're back on results page
                                        const backOnResults = await page.evaluate(() => {
                                            return document.querySelectorAll('input[type="button"][value="IndexII"]').length > 0;
                                        });
                                        
                                        if (!backOnResults) {
                                            console.log('Failed to get back to results page, trying browser back again');
                                            await page.goBack();
                                            await new Promise(resolve => setTimeout(resolve, 5000));
                                        }
                                    }
                                } catch (err) {
                                    console.error('Error navigating back to results page:', err.message);
                                }
                            };
                            
                            // Make sure we're on the results page before clicking
                            await backToResultsPage();
                            
                            // Click the button by its index
                            const buttonClicked = await page.evaluate((buttonIndex) => {
                                try {
                                    const buttons = Array.from(document.querySelectorAll('input[type="button"][value="IndexII"]'));
                                    if (buttons.length > buttonIndex) {
                                        buttons[buttonIndex].click();
                                        return true;
                                    }
                                    return false;
                                } catch (err) {
                                    console.error('Error clicking button in evaluate:', err.message);
                                    return false;
                                }
                            }, i);
                            
                            if (!buttonClicked) {
                                console.log(`Failed to click button ${i + 1}, trying again...`);
                                // Try a more direct approach
                                try {
                                    const buttons = await page.$$('input[type="button"][value="IndexII"]');
                                    if (buttons.length > i) {
                                        await buttons[i].click();
                                        console.log(`Clicked button directly through selector`);
                                    } else {
                                        console.log(`Button ${i + 1} not found in direct selector approach`);
                                    }
                                } catch (err) {
                                    console.error(`Error in direct button click: ${err.message}`);
                                }
                            }

                            // Wait for new page/content to load
                            console.log('Waiting for page to load after clicking IndexII button...');
                            await new Promise(resolve => setTimeout(resolve, 8000)); // Increased wait time
                            
                            // Check for new tabs/pages
                            try {
                                // Get all pages
                                const allPages = await browser.pages();
                                console.log(`Found ${allPages.length} pages open in browser`);
                                
                                // Find any newly opened pages (that aren't the main page)
                                let documentFound = false;
                                
                                for (let pg of allPages) {
                                    try {
                                        const url = await pg.url();
                                        console.log(`Checking page URL: ${url}`);
                                        
                                        // If this is not the main page, it's likely our document
                                        if (url !== 'https://freesearchigrservice.maharashtra.gov.in/' && url !== 'about:blank') {
                                            console.log(`Found document page with URL: ${url}`);
                                            documentFound = true;
                                            
                                            // Create base documents folder if it doesn't exist
                                            if (!fs.existsSync('documents')) {
                                                fs.mkdirSync('documents');
                                            }
                                            
                                            // Create village-specific folder
                                            const villageFolderName = village.replace(/[\/\\?%*:|"<>]/g, '-').trim() || 'unknown-village';
                                            const villageFolder = path.join('documents', villageFolderName);
                                            
                                            if (!fs.existsSync(villageFolder)) {
                                                fs.mkdirSync(villageFolder);
                                                console.log(`Created folder for village: ${villageFolderName}`);
                                            }
                                            
                                            // Wait a bit longer for document to fully load
                                            await new Promise(resolve => setTimeout(resolve, 5000));
                                            
                                            // Save PDF with timestamp in the village folder
                                            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                                            const pdfPath = path.join(villageFolder, `document-${i + 1}-${timestamp}.pdf`);
                                            console.log(`Saving PDF to ${pdfPath}...`);
                                            
                                            try {
                                                // Generate PDF
                                                await pg.pdf({
                                                    path: pdfPath,
                                                    format: 'A4',
                                                    printBackground: true,
                                                    margin: {
                                                        top: '20px',
                                                        right: '20px',
                                                        bottom: '20px',
                                                        left: '20px'
                                                    }
                                                });
                                                
                                                console.log(`Successfully saved PDF: ${pdfPath}`);
                                                
                                                // Close page after saving PDF
                                                await pg.close();
                                                console.log('Closed document page after saving PDF');
                                                break;
                                            } catch (pdfError) {
                                                console.error(`Error saving PDF: ${pdfError.message}`);
                                            }
                                        }
                                    } catch (err) {
                                        console.log(`Error processing page: ${err.message}`);
                                    }
                                }
                                
                                if (!documentFound) {
                                    console.log('No document page found among browser pages');
                                    
                                    // As fallback, check if main page URL has changed
                                    const currentUrl = await page.url();
                                    if (currentUrl !== 'https://freesearchigrservice.maharashtra.gov.in/') {
                                        console.log('Main page URL has changed, might be a document');
                                        
                                        // Create base documents folder if it doesn't exist
                                        if (!fs.existsSync('documents')) {
                                            fs.mkdirSync('documents');
                                        }
                                        
                                        // Create village-specific folder
                                        const villageFolderName = village.replace(/[\/\\?%*:|"<>]/g, '-').trim() || 'unknown-village';
                                        const villageFolder = path.join('documents', villageFolderName);
                                        
                                        if (!fs.existsSync(villageFolder)) {
                                            fs.mkdirSync(villageFolder);
                                            console.log(`Created folder for village: ${villageFolderName}`);
                                        }
                                        
                                        // Save PDF with timestamp in the village folder
                                        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                                        const pdfPath = path.join(villageFolder, `document-main-${i + 1}-${timestamp}.pdf`);
                                        console.log(`Saving main page as PDF: ${pdfPath}`);
                                        
                                        try {
                                            await page.pdf({
                                                path: pdfPath,
                                                format: 'A4',
                                                printBackground: true
                                            });
                                            
                                            console.log(`Successfully saved main page as PDF: ${pdfPath}`);
                                            
                                            // Go back to results page
                                            await page.goBack();
                                            await new Promise(resolve => setTimeout(resolve, 5000));
                                        } catch (pdfError) {
                                            console.error(`Error saving main page PDF: ${pdfError.message}`);
                                        }
                                    }
                                }
                                
                                // Make sure we get back to results page for the next button
                                await backToResultsPage();
                                
                            } catch (err) {
                                console.error(`Error handling pages after IndexII click: ${err.message}`);
                                // Try to recover and continue with next button
                                await backToResultsPage();
                            }
                            
                            // Wait before next button
                            await new Promise(resolve => setTimeout(resolve, 5000));
                        }

                        console.log(`Finished processing all ${indexButtons.length} IndexII buttons`);
                    } else {
                        console.log('No IndexII buttons found. Looking for alternative elements...');

                        // Try looking for #indexII element
                        const hasIndexInput = await page.evaluate(() => {
                            return document.querySelector('#indexII') !== null;
                        });

                        if (hasIndexInput) {
                            console.log('Found indexII input element. Clicking it...');
                            await page.click('#indexII');
                            console.log('Clicked on indexII input');
                            await new Promise(resolve => setTimeout(resolve, 5000));
                        } else {
                            console.log('No indexII elements found. Taking screenshot of current page...');
                            await page.screenshot({
                                path: 'no-index-buttons-found.png',
                                fullPage: true
                            });
                        }
                    }

                    console.log('All IndexII buttons processed');
                } catch (error) {
                    console.error('Error processing IndexII buttons:', error.message);

                    // Take screenshot of the error state
                    await page.screenshot({
                        path: 'index-button-processing-error.png',
                        fullPage: true
                    });
                }
            } else {
                throw new Error('Failed to verify CAPTCHA after maximum attempts');
            }

            // After processing results
            result.success = true;
            result.message = 'Property search completed';
            result.propertyData = resultsData; // Assuming resultsData contains the property info

        } catch (error) {
            console.error('Dropdown handling error:', error.message);
            result.success = false;
            result.message = `Error: ${error.message}`;
            await page.screenshot({
                path: 'dropdown-error.png',
                fullPage: true
            });
        }
    } catch (error) {
        console.error('Automation error:', error.message);
        result.success = false;
        result.message = `Automation error: ${error.message}`;
        await page.screenshot({
            path: 'error-screenshot.png',
            fullPage: true
        });
    } finally {
        // Only close the browser if not keeping it open
        if (!keepBrowserOpen) {
            await browser.close();
        } else {
            console.log('Keeping browser open as requested');
            result.browserKeptOpen = true;
        }
        return result;
    }
}

// Add this function to download the captcha image
async function downloadCaptchaImage(page) {
    try {
        const captchaElement = await page.$('#imgCaptcha_new');
        if (!captchaElement) {
            console.error('CAPTCHA element not found');
            return false;
        }

        // Take a screenshot of the captcha
        const captchaBox = await captchaElement.boundingBox();
        const screenshot = await page.screenshot({
            clip: {
                x: captchaBox.x,
                y: captchaBox.y,
                width: captchaBox.width,
                height: captchaBox.height
            }
        });

        // Save the captcha image
        const fs = require('fs');
        const path = require('path');
        const imagePath = path.join(__dirname, 'current-captcha.png');
        fs.writeFileSync(imagePath, screenshot);
        console.log(`CAPTCHA image saved to: ${imagePath}`);
        return true;
    } catch (error) {
        console.error('Error downloading CAPTCHA image:', error);
        return false;
    }
}

// Instead, use this function to handle CAPTCHA
async function handleCaptcha(page, browser) {
    try {
        // Get the current CAPTCHA image element
        const captchaImage = await page.$('#imgCaptcha_new');

        if (!captchaImage) {
            console.error('CAPTCHA image element not found');
            return false;
        }

        // Get the complete image URL
        const captchaUrl = await page.evaluate(img => img.src, captchaImage);
        console.log('Found CAPTCHA URL:', captchaUrl);

        if (!captchaUrl || !captchaUrl.includes('txt=')) {
            // Take screenshot approach
            const captchaBox = await captchaImage.boundingBox();
            const screenshot = await page.screenshot({
                clip: {
                    x: captchaBox.x,
                    y: captchaBox.y,
                    width: captchaBox.width,
                    height: captchaBox.height
                }
            });

            const fs = require('fs');
            const path = require('path');
            const imagePath = path.join(__dirname, 'current-captcha.png');
            fs.writeFileSync(imagePath, screenshot);
            console.log(`CAPTCHA screenshot saved to: ${imagePath}`);
        } else {
            // URL download approach
            try {
                const txtParam = captchaUrl.split('txt=')[1];
                const tempPage = await browser.newPage();
                await tempPage.setRequestInterception(true);

                let imageBuffer = null;

                tempPage.on('request', request => request.continue());
                tempPage.on('response', async response => {
                    if (response.url().includes('Handler.ashx?txt=')) {
                        try {
                            imageBuffer = await response.buffer();
                        } catch (err) {
                            console.error('Error getting buffer:', err);
                        }
                    }
                });

                await tempPage.goto(`https://freesearchigrservice.maharashtra.gov.in/Handler.ashx?txt=${txtParam}`, {
                    waitUntil: 'networkidle0',
                    timeout: 10000
                });

                if (imageBuffer) {
                    const fs = require('fs');
                    const path = require('path');
                    const imagePath = path.join(__dirname, 'current-captcha.png');
                    fs.writeFileSync(imagePath, imageBuffer);
                    console.log(`CAPTCHA image saved to: ${imagePath}`);
                }

                await tempPage.close();
            } catch (err) {
                console.error('Error downloading CAPTCHA:', err);

                // Fall back to screenshot method
                const captchaBox = await captchaImage.boundingBox();
                const screenshot = await page.screenshot({
                    clip: {
                        x: captchaBox.x,
                        y: captchaBox.y,
                        width: captchaBox.width,
                        height: captchaBox.height
                    }
                });

                const fs = require('fs');
                const path = require('path');
                const imagePath = path.join(__dirname, 'current-captcha.png');
                fs.writeFileSync(imagePath, screenshot);
                console.log(`CAPTCHA screenshot saved as fallback: ${imagePath}`);
            }
        }

        // Return true without asking for terminal input
        return true;
    } catch (error) {
        console.error('Error in CAPTCHA handling:', error.message);
        return false;
    }
}

// Add this function to scrape property data after CAPTCHA submission
async function scrapePropertyData(page) {
    try {
        console.log('Form submitted successfully.');

        // Give more time for the page to load after CAPTCHA submission
        console.log('Waiting for page to process after submission...');
        await new Promise(resolve => setTimeout(resolve, 10000));

        // Initialize the property data object
        const propertyData = {
            indexButtons: [],
            details: [],
            screenshots: []
        };

        // Wait for results page to load
        console.log('Checking for IndexII buttons in tables...');

        try {
            // Look for all input buttons with value "IndexII" within table rows
            const indexButtons = await page.evaluate(() => {
                // Find all input buttons with value "IndexII"
                const buttons = Array.from(document.querySelectorAll('input[type="button"][value="IndexII"]'));

                // Return information about each button for logging
                return buttons.map((button, index) => {
                    // Find the closest table row for context
                    const row = button.closest('tr');
                    let rowText = '';

                    if (row) {
                        // Get text from the first few cells in the row for identification
                        const cells = Array.from(row.querySelectorAll('td')).slice(0, 3);
                        rowText = cells.map(cell => cell.innerText.trim()).join(' | ');
                    }

                    return {
                        index,
                        rowText,
                        found: true
                    };
                });
            });

            console.log(`Found ${indexButtons.length} IndexII buttons`);
            propertyData.indexButtons = indexButtons;

            if (indexButtons.length > 0) {
                console.log('IndexII buttons found in these rows:');
                indexButtons.forEach(btn => {
                    console.log(`Button ${btn.index + 1}: ${btn.rowText}`);
                });

                // Process each button one by one
                for (let i = 0; i < indexButtons.length; i++) {
                    console.log(`Clicking on IndexII button ${i + 1} of ${indexButtons.length}...`);

                    // Check if we're on the results page
                    const backToResultsPage = async () => {
                        try {
                            // Check if we're on the results page
                            const isOnResultsPage = await page.evaluate(() => {
                                return document.querySelectorAll('input[type="button"][value="IndexII"]').length > 0;
                            });
                            
                            if (!isOnResultsPage) {
                                console.log('Navigating back to results page...');
                                await page.goBack();
                                await new Promise(resolve => setTimeout(resolve, 5000));
                                
                                // Verify we're back on results page
                                const backOnResults = await page.evaluate(() => {
                                    return document.querySelectorAll('input[type="button"][value="IndexII"]').length > 0;
                                });
                                
                                if (!backOnResults) {
                                    console.log('Failed to get back to results page, trying browser back again');
                                    await page.goBack();
                                    await new Promise(resolve => setTimeout(resolve, 5000));
                                }
                            }
                        } catch (err) {
                            console.error('Error navigating back to results page:', err.message);
                        }
                    };
                    
                    // Make sure we're on the results page before clicking
                    await backToResultsPage();
                    
                    // Click the button by its index
                    const buttonClicked = await page.evaluate((buttonIndex) => {
                        try {
                            const buttons = Array.from(document.querySelectorAll('input[type="button"][value="IndexII"]'));
                            if (buttons.length > buttonIndex) {
                                buttons[buttonIndex].click();
                                return true;
                            }
                            return false;
                        } catch (err) {
                            console.error('Error clicking button in evaluate:', err.message);
                            return false;
                        }
                    }, i);
                    
                    if (!buttonClicked) {
                        console.log(`Failed to click button ${i + 1}, trying again...`);
                        // Try a more direct approach
                        try {
                            const buttons = await page.$$('input[type="button"][value="IndexII"]');
                            if (buttons.length > i) {
                                await buttons[i].click();
                                console.log(`Clicked button directly through selector`);
                            } else {
                                console.log(`Button ${i + 1} not found in direct selector approach`);
                            }
                        } catch (err) {
                            console.error(`Error in direct button click: ${err.message}`);
                        }
                    }

                    // Wait for new page/content to load
                    console.log('Waiting for page to load after clicking IndexII button...');
                    await new Promise(resolve => setTimeout(resolve, 8000)); // Increased wait time
                    
                    // Check for new tabs/pages
                    try {
                        // Get all pages
                        const allPages = await browser.pages();
                        console.log(`Found ${allPages.length} pages open in browser`);
                        
                        // Find any newly opened pages (that aren't the main page)
                        let documentFound = false;
                        
                        for (let pg of allPages) {
                            try {
                                const url = await pg.url();
                                console.log(`Checking page URL: ${url}`);
                                
                                // If this is not the main page, it's likely our document
                                if (url !== 'https://freesearchigrservice.maharashtra.gov.in/' && url !== 'about:blank') {
                                    console.log(`Found document page with URL: ${url}`);
                                    documentFound = true;
                                    
                                    // Create base documents folder if it doesn't exist
                                    if (!fs.existsSync('documents')) {
                                        fs.mkdirSync('documents');
                                    }
                                    
                                    // Create village-specific folder
                                    const villageFolderName = village.replace(/[\/\\?%*:|"<>]/g, '-').trim() || 'unknown-village';
                                    const villageFolder = path.join('documents', villageFolderName);
                                    
                                    if (!fs.existsSync(villageFolder)) {
                                        fs.mkdirSync(villageFolder);
                                        console.log(`Created folder for village: ${villageFolderName}`);
                                    }
                                    
                                    // Wait a bit longer for document to fully load
                                    await new Promise(resolve => setTimeout(resolve, 5000));
                                    
                                    // Save PDF with timestamp in the village folder
                                    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                                    const pdfPath = path.join(villageFolder, `document-${i + 1}-${timestamp}.pdf`);
                                    console.log(`Saving PDF to ${pdfPath}...`);
                                    
                                    try {
                                        // Generate PDF
                                        await pg.pdf({
                                            path: pdfPath,
                                            format: 'A4',
                                            printBackground: true,
                                            margin: {
                                                top: '20px',
                                                right: '20px',
                                                bottom: '20px',
                                                left: '20px'
                                            }
                                        });
                                        
                                        console.log(`Successfully saved PDF: ${pdfPath}`);
                                        
                                        // Close page after saving PDF
                                        await pg.close();
                                        console.log('Closed document page after saving PDF');
                                        break;
                                    } catch (pdfError) {
                                        console.error(`Error saving PDF: ${pdfError.message}`);
                                    }
                                }
                            } catch (err) {
                                console.log(`Error processing page: ${err.message}`);
                            }
                        }
                        
                        if (!documentFound) {
                            console.log('No document page found among browser pages');
                            
                            // As fallback, check if main page URL has changed
                            const currentUrl = await page.url();
                            if (currentUrl !== 'https://freesearchigrservice.maharashtra.gov.in/') {
                                console.log('Main page URL has changed, might be a document');
                                
                                // Create base documents folder if it doesn't exist
                                if (!fs.existsSync('documents')) {
                                    fs.mkdirSync('documents');
                                }
                                
                                // Create village-specific folder
                                const villageFolderName = village.replace(/[\/\\?%*:|"<>]/g, '-').trim() || 'unknown-village';
                                const villageFolder = path.join('documents', villageFolderName);
                                
                                if (!fs.existsSync(villageFolder)) {
                                    fs.mkdirSync(villageFolder);
                                    console.log(`Created folder for village: ${villageFolderName}`);
                                }
                                
                                // Save PDF with timestamp in the village folder
                                const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                                const pdfPath = path.join(villageFolder, `document-main-${i + 1}-${timestamp}.pdf`);
                                console.log(`Saving main page as PDF: ${pdfPath}`);
                                
                                try {
                                    await page.pdf({
                                        path: pdfPath,
                                        format: 'A4',
                                        printBackground: true
                                    });
                                    
                                    console.log(`Successfully saved main page as PDF: ${pdfPath}`);
                                    
                                    // Go back to results page
                                    await page.goBack();
                                    await new Promise(resolve => setTimeout(resolve, 5000));
                                } catch (pdfError) {
                                    console.error(`Error saving main page PDF: ${pdfError.message}`);
                                }
                            }
                        }
                        
                        // Make sure we get back to results page for the next button
                        await backToResultsPage();
                        
                    } catch (err) {
                        console.error(`Error handling pages after IndexII click: ${err.message}`);
                        // Try to recover and continue with next button
                        await backToResultsPage();
                    }
                    
                    // Wait before next button
                    await new Promise(resolve => setTimeout(resolve, 5000));
                }

                console.log(`Finished processing all ${indexButtons.length} IndexII buttons`);
            } else {
                console.log('No IndexII buttons found. Looking for alternative elements...');

                // Try looking for #indexII element
                const hasIndexInput = await page.evaluate(() => {
                    return document.querySelector('#indexII') !== null;
                });

                if (hasIndexInput) {
                    console.log('Found indexII input element. Clicking it...');
                    await page.click('#indexII');
                    console.log('Clicked on indexII input');
                    await new Promise(resolve => setTimeout(resolve, 5000));
                } else {
                    console.log('No indexII elements found. Continuing with result processing...');
                }
            }

            // Extract results from any result tables present
            console.log('Looking for result tables...');

            // Try multiple selectors for result tables
            await Promise.race([
                page.waitForSelector('table#gvDocDetails', { timeout: 20000 }),
                page.waitForSelector('table.gridview', { timeout: 20000 }),
                page.waitForSelector('.search-results', { timeout: 20000 })
            ]).catch(() => console.log('No result tables found, continuing anyway'));

            console.log('Results page processed');

            // Extract table data
            const resultsData = await page.evaluate(() => {
                const resultTable = document.querySelector('table#gvDocDetails') ||
                    document.querySelector('table.gridview') ||
                    document.querySelector('.search-results');

                if (!resultTable) return { success: false, message: 'No results table found' };

                // Extract table headers
                const headers = Array.from(resultTable.querySelectorAll('th')).map(th => th.innerText.trim());

                // Extract table rows
                const rows = Array.from(resultTable.querySelectorAll('tr')).slice(1); // Skip header row

                const data = rows.map(row => {
                    const cells = Array.from(row.querySelectorAll('td'));
                    const rowData = {};

                    cells.forEach((cell, index) => {
                        if (headers[index]) {
                            rowData[headers[index]] = cell.innerText.trim();
                        }
                    });

                    return rowData;
                });

                // Check for "View Details" links
                const hasDetailsLinks = rows.some(row => {
                    return Array.from(row.querySelectorAll('a')).some(link =>
                        link.innerText.includes('View') || link.innerText.includes('Details')
                    );
                });

                return {
                    success: true,
                    data: data,
                    hasDetailsLinks: hasDetailsLinks
                };
            });

            if (resultsData.success) {
                console.log('Found results data:');
                console.log(JSON.stringify(resultsData.data, null, 2));

                // Take screenshot of results table
                const screenshotPath = 'search-results-table.png';
                await page.screenshot({ path: screenshotPath, fullPage: true });
                propertyData.screenshots.push({
                    path: screenshotPath,
                    type: 'results_table'
                });
            } else {
                console.log('No results data found or error parsing results');

                // Take screenshot of the current state
                const screenshotPath = 'search-results-error.png';
                await page.screenshot({ path: screenshotPath, fullPage: true });
                propertyData.screenshots.push({
                    path: screenshotPath,
                    type: 'error'
                });
            }

            return propertyData;
        } catch (error) {
            console.error('Error in scrapePropertyData:', error.message);

            // Take screenshot of the error state
            const screenshotPath = 'property-data-error.png';
            await page.screenshot({ path: screenshotPath, fullPage: true });

            return {
                error: true,
                message: error.message,
                screenshot: screenshotPath
            };
        }
    } catch (error) {
        console.error('Error in scrapePropertyData outer try block:', error.message);
        
        // Take screenshot of the error state
        const screenshotPath = 'property-data-error.png';
        await page.screenshot({ path: screenshotPath, fullPage: true });

        return {
            error: true,
            message: error.message,
            screenshot: screenshotPath
        };
    }
} // Added the missing closing brace here

// Export the function for use in the server
module.exports = automateForm;