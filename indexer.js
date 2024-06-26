import { Builder, By, Key, until } from 'selenium-webdriver';
import chrome from 'selenium-webdriver/chrome.js';
import { EventEmitter } from 'events';
const indexerEvents = new EventEmitter();
import eventEmitter from './eventEmitter.js';  
import { fetchGitHubContent } from './fetchGitHubContent.js';
import { displayLogMessage} from './blessed.js';

async function loadExistingData(baseUrl) {
    let data_received = await fetchDataFromWorker(baseUrl, 'baseUrlSearch');
    if (data_received) {
        // console.log(`Data received from worker for ${baseUrl}:`);  // Log the data received
        let data = {
            baseUrl: baseUrl,
            data_received: data_received
        };
        eventEmitter.emit('dataSaved', { data });
        return {
            links: new Map(Object.entries(data_received.links)),
            allLinks: new Set(Object.keys(data_received.links)),
            totalWords: data_received.totalWords,
            filteredTotalWords: data_received.filteredTotalWords
        };
    } else {
        // console.log(`No data or links found for ${baseUrl}.`);
        return {
            links: new Map(),
            allLinks: new Set(),
            totalWords: 0,
            filteredTotalWords: 0
        };
    }
}

async function saveLinks(links, baseUrl, totalWords, totalLinks, filteredTotalWords) {
    saveData(links, baseUrl, totalWords, totalLinks, filteredTotalWords);
    saveDataToWorker(baseUrl, totalWords, totalLinks, filteredTotalWords, links)
        .catch(error => {
            displayLogMessage(`Error: Failed to save data to worker asynchronously: ${error}`);
        });
    return
}

function saveData(links, baseUrl, totalWords, totalLinks, filteredTotalWords) {
    let data_corpus = {
        totalWords: totalWords,
        totalLinks: totalLinks,
        filteredTotalWords: filteredTotalWords,
        links: links
    };
    let data = {
        baseUrl: baseUrl,
        data_received: data_corpus
    };
    eventEmitter.emit('dataSaved', { data });
}

const workerUrl = 'https://worker-aged-night-839d.i-f9f.workers.dev';

async function saveDataToWorker(baseUrl, totalWords, totalLinks, filteredTotalWords, links) {
    // console.log('Saving data to worker');
    try {
        const data = {
            type: 'indexData',
            baseUrl: baseUrl,
            totalWords: totalWords,
            totalLinks: totalLinks,
            filteredTotalWords: filteredTotalWords,
            links: links  // Ensure this is correctly structured for serialization
        };
        const response = await fetch(workerUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        const result = await response.json();
        // console.log('result: ',result);
    } catch (error) {
        displayLogMessage(`Error: Failed to send data to worker: ${error}`);
    }
}

async function fetchDataFromWorker(url, searchType) {
    try {
        const response = await fetch(workerUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: searchType, url: url })
        });

        if (!response.ok) {
            const errorBody = await response.text();

            if (response.status === 404) {
                // console.log(`No data found for URL: ${url}`);
                return null; // Return null for 404 Not Found
            } else if (response.status === 422) {
                // Handle the 422 Unprocessable Entity status
                const errorData = JSON.parse(errorBody);
                // console.log(`Data found but not suitable for URL: ${url}, Status: ${errorData.status}`);
                return errorData; // Return the error data for further handling
            }

            displayLogMessage(`Error: HTTP error! status: ${response.status} ${response.statusText}`);
            displayLogMessage(`Error: response body: ${errorBody}`);
            // For other error statuses, you might still want to throw an error
            throw new Error(`HTTP error! status: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        // console.log('Data received from worker:');
        return data;
    } catch (error) {
        displayLogMessage(`Error: Failed to fetch data from worker: ${error}`);
        // Instead of re-throwing the error, handle it gracefully
        return { error: true, message: error.message };
    }
}

function countWords(text) {
    if (!text) return 0; // Return 0 if text is undefined or null
    return text.split(/\s+/).filter(Boolean).length;
}

function countLineOccurrences(allTexts) {
    let lineCounts = {};
    allTexts.forEach(text => {
        text.split('\n').forEach(line => {
            lineCounts[line] = (lineCounts[line] || 0) + 1;
        });
    });
    return lineCounts;
}

// Helper function to filter lines based on occurrences
function filterLines(text, lineCounts, maxOccurrences) {
    return text.split('\n').filter(line => lineCounts[line] <= maxOccurrences).join('\n');
}

function buildDriver() {
    let options = new chrome.Options();
    // Set a custom user agent string
    options.addArguments(`user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/88.0.4324.150 Safari/537.36`);
    options.addArguments('--headless');  // Run in headless mode
    options.addArguments('--disable-gpu');  // Disable GPU hardware acceleration
    options.addArguments('--window-size=1920,1080');  
    // Initialize the Chrome driver with these options
    let driver = new Builder()
        .forBrowser('chrome')
        .setChromeOptions(options)
        .build();

    return driver;
}

async function acceptCookies(driver) {
    try {
        // Wait for the cookie consent bar to appear and the button to be clickable
        const cookieButton = await driver.wait(until.elementLocated(By.xpath("//button[contains(text(), 'Accept Cookies')]")), 1000);
        await driver.wait(until.elementIsEnabled(cookieButton), 5000);  // Ensure the button is clickable
        await cookieButton.click();
        return true;  // Return true when cookies are successfully accepted
    } catch (error) {
        return false;  // Return false if there was an error
    }
}

async function indexLink(driver, url, allLinks, doneLinksCount, totalWords, filteredTotalWords, allTexts, maxOccurrences) {
    try {
        let allText; // Declare allText at the function scope
        let wordCount;
        let timestamp;
        let cookieStatus = 'n/a';
        let data_received = await fetchDataFromWorker(url, 'linkSearch');
        let status = ''; // Declare status at the function scope
        let extraData = null;

        if (data_received && data_received.status === 'Looks good') {
            // console.log('Data fetched successfully for URL:', url);
            status = data_received.status; // Assign status from result
            allText = data_received.content;
            wordCount = data_received.word_count;
            timestamp = data_received.indexed_timestamp;
            // filteredText= result.filtered_content;
            // filteredWordCount= result.filtered_word_count;
        } else {
            // console.log('proceeding with driver')
            await driver.get(url);
            let cookiesAccepted = await acceptCookies(driver);  // Capture the return value
            allText = await driver.executeScript("return document.documentElement.innerText");
            wordCount = countWords(allText); // Use the robust countWords function
            timestamp = new Date().toISOString();
            cookieStatus = cookiesAccepted ? "Accepted" : "n/a";
            let attempt = 0;
            const maxAttempts = 3;

            while (attempt < maxAttempts) {
                try {
                    let linksElements = await driver.findElements(By.tagName('a'));
                    for (let link of linksElements) {
                        let href = await link.getAttribute('href');
                        if (href) {
                            let linkUrl = new URL(href, url); // Resolve relative URLs and ensure absolute URL
                            if (linkUrl.origin === new URL(url).origin) { // Check if the link belongs to the same domain
                                href = linkUrl.href.split('#')[0]; // Normalize and remove any fragment
                                if (!allLinks.has(href)) {
                                    allLinks.add(href);
                                }
                            }
                        }
                    }
                    break;
                } catch (error) {
                    attempt++;
                    if (attempt === maxAttempts) {
                        displayLogMessage(`Error: \nFailed to retrieve links after several attempts. Error: ${error}`);
                    }
                }
            }
            if (allText.length < 100) {
                status = 'Seems like it failed';
            } else {
                status = 'Looks good';
            }
        }
        if (url.includes('github.com')) {
            try {
                // Fetch extra data from GitHub using the fetchGitHubContent function
                extraData = await fetchGitHubContent(url);
                allText = allText + '\n\n' + extraData;
            } catch (error) {
                displayLogMessage(`Error: fetching extra data for ${url}, ${error}`);
            }
        }
        eventEmitter.emit('data_received', { message: `${doneLinksCount} / ${allLinks.size} links, ${filteredTotalWords} words processed` });
        allTexts.push(allText); // Collect all texts for line occurrence counting
        let lineCounts = countLineOccurrences(allTexts);
        let filteredText = filterLines(allText, lineCounts, maxOccurrences); // Filter lines based on occurrences
        let filteredWordCount = countWords(filteredText);
        return { allLinks, allText, filteredText, status, wordCount, filteredWordCount, totalWords, cookieStatus, timestamp };
    } catch (error) {
        if (error.name === 'WebDriverError' && error.message.includes('net::ERR_NAME_NOT_RESOLVED')) {
            displayLogMessage(`Error: The URL ${url} could not be resolved. It may be incorrect or the domain may be unreachable.`);
            attempt++;  // Increment the attempt counter
            if (attempt < maxAttempts) {
                driver = await buildDriver(); // Reinitialize the driver
                return indexLink(driver, url, allLinks, doneLinksCount, totalWords, filteredTotalWords, allTexts, maxOccurrences); // Retry the operation
            } else {
                displayLogMessage(`Error: Maximum retry attempts reached, skipping URL: ${url}`);
                return { allLinks, allText, filteredText, status: 'Seems like it failed', wordCount, filteredWordCount, totalWords, cookieStatus, timestamp };
            }
        } else {
            displayLogMessage(`Error: indexing ${url}: ${error}`);
            return { allLinks, allText, filteredText, status: 'Seems like it failed', wordCount, filteredWordCount, totalWords, cookieStatus, timestamp };
        }
    }
}

const MAX_WORDS = 1000000; // Limit of 1 million words

export async function main(baseUrl) {
    let driver = buildDriver();
    const maxOccurrences = 1;
    let { links, allLinks, totalWords, filteredTotalWords} = await loadExistingData(baseUrl);

    if (!links || links.size === 0) {
        links = new Map([[baseUrl, { status: "not_indexed", word_count: 0 }]]);
        allLinks = new Set();
        totalWords = 0;
        filteredTotalWords = 0;
    }

    let allTexts = [];
    let doneLinksCount = 0;

    for (let [url, info] of links) {
        if (info.status === 'Looks good') {
            doneLinksCount++;
        }
    }

    try {
        while (Array.from(links.values()).some(v => v.status === "not_indexed")) {
            for (let [url, info] of links) {
                if (info.status === "not_indexed") {

                    let result = await indexLink(driver, url, allLinks, doneLinksCount, totalWords, filteredTotalWords, allTexts, maxOccurrences);
                    if (!result) {
                        // console.error('No result returned from indexLink for URL:', url);
                        continue;
                    }

                    allLinks = result.allLinks;
                    totalWords += result.wordCount;
                    filteredTotalWords += result.filteredWordCount;
                    if (result.status === 'Looks good') {
                        doneLinksCount++;
                    }
                    eventEmitter.emit('data_received', { message: `${doneLinksCount} / ${allLinks.size} links, ${filteredTotalWords} words processed` });
                    // console.log('data_received', { message: `${doneLinksCount} / ${allLinks.size} links, ${filteredTotalWords} words processed` });

                    if (result.status === 'Seems like it failed') {
                        displayLogMessage(`Error: Failed to index ${url}. Exiting...`);
                        displayLogMessage(`Error: Content: ${result.allText}`);
                        if (url === baseUrl) { 
                            let data = {baseUrl: baseUrl};
                            eventEmitter.emit('indexingFailed', { data });
                        }
                        return;
                    }

                    for (let link of allLinks) {
                        if (!links.has(link)) {
                            links.set(link, { status: "not_indexed", word_count: 0, filtered_word_count: 0, filtered_content: "", added_timestamp: result.timestamp });
                        }
                    }
                    links.set(url, { status: result.status, indexed_timestamp: result.timestamp, content: result.allText, word_count: result.wordCount, filtered_content: result.filteredText, filtered_word_count: result.filteredWordCount });
                    await saveLinks(Object.fromEntries(links), baseUrl, totalWords, allLinks.size, filteredTotalWords);
                }
            }
        }
        eventEmitter.emit('data_received', { message: `\nIndexing complete. Total links: ${allLinks.size}, Total words: ${totalWords}, Filtered total words: ${filteredTotalWords}`});
    } finally {
        await driver.quit();
    }
    return
}

