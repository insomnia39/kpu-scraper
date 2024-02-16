import axios from 'axios';
import fs from 'fs';
import path from 'path';

function getTodayDate() {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function formatNumberPerThousand(number) {
    return number.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function formatNumberPercentage(number) {
    return `${number}%`;
}

function generateLocationCode(location) {
    let locationCode = "";
    locationCode += location.provinceCode ? `/${location.provinceCode}` : "";
    locationCode += location.cityCode ? `/${location.cityCode}` : "";
    locationCode += location.districtCode ? `/${location.districtCode}` : "";
    locationCode += location.subdistrictCode ? `/${location.subdistrictCode}` : "";
    locationCode += location.tpsCode ? `/${location.tpsCode}` : "";
    return locationCode;
}

function splitArrayIntoSubarrays(arr, maxLength) {
    return Array.from({ length: Math.ceil(arr.length / maxLength) }, (_, index) =>
        arr.slice(index * maxLength, (index + 1) * maxLength)
    );
}

function calculatePercentage(numerator, denominator) {
    return denominator === 0 ? 0 : Number(((numerator / denominator) * 100).toFixed(2));
}

function getLocationUrl(location) {
    const locationCode = generateLocationCode(location);
    const baseUrl = "https://sirekap-obj-data.kpu.go.id/wilayah/pemilu/ppwp";
    return `${baseUrl}${locationCode}.json`;
}

function getVoteDataUrl(location) {
    const locationCode = generateLocationCode(location);
    const baseUrl = "https://sirekap-obj-data.kpu.go.id/pemilu/hhcw/ppwp";
    return `${baseUrl}${locationCode}.json`;
}

async function getLocations(location) {
    const url = getLocationUrl(location);
    const response = await axios.get(url);
    const locations = response.data;
    return locations;
}

async function getVoteData(location) {
    const url = getVoteDataUrl(location);
    const response = await axios.get(url);
    response.data.location = location;
    return response.data;
}

function saveFile(data, title) {
    let jsonData = JSON.stringify(data)
    const filePath = path.join(path.dirname(title), path.basename(title));

    try {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(title, jsonData);
        console.log(`JSON data written to ${title}`)
    } catch (e) {
        console.error("Error writing file:", e);
    }
}

async function getAllLocations() {
    const provinces = openJson(`./provinces.json`);
    for (let province of provinces) {
        let cities = await getLocations({ provinceCode : province.kode });
        province.children = cities;

        const districtPromises = cities.map(city =>
            getLocations({ provinceCode: province.kode, cityCode: city.kode })
        );
        const listDistricts = await Promise.all(districtPromises);
        const districtLocations = []

        for (let city of cities) {
            const filteredDistricts = listDistricts.filter(districts =>
                districts[0].kode.startsWith(city.kode)
            );

            let districts = filteredDistricts[0];
            city.children = districts;
            districts.forEach(district => districtLocations.push({provinceCode: province.kode, cityCode: city.kode, districtCode: district.kode}));
        }

        let subLocations = [];
        const listSubdistricts = []
        subLocations = splitArrayIntoSubarrays(districtLocations, 100);
        for (let locations of subLocations) {
            const locationPromises = locations.map(location => getLocations(location));
            const result = await Promise.all(locationPromises);
            listSubdistricts.push(...result);
        }

        const subdistrictLocations = []

        for (let city of cities) {
            for (let district of city.children) {
                const filteredDatas = listSubdistricts.filter(datas =>
                    datas[0].kode.startsWith(district.kode)
                );
                let subdistricts = filteredDatas[0];
                district.children = subdistricts;
                subdistricts.forEach(subdistrict => subdistrictLocations.push({provinceCode: province.kode, cityCode: city.kode, districtCode: district.kode, subdistrictCode: subdistrict.kode}))
            }
        }

        const listTpss = [];
        subLocations = splitArrayIntoSubarrays(subdistrictLocations, 100);
        let i = 0;
        for (let locations of subLocations) {
            const locationPromises = locations.map(location => getLocations(location));
            const result = await Promise.all(locationPromises);
            listTpss.push(...result);
            console.log(`${province.nama} : ${calculatePercentage(++i, subLocations.length)}`)
        }

        for (let city of cities) {
            for (let district of city.children) {
                for (let subdistrict of district.children) {
                    const filteredDatas = listTpss.filter(datas =>
                        datas[0].kode.startsWith(subdistrict.kode)
                    );
                    subdistrict.children = filteredDatas[0];
                }
            }
        }

        saveFile(province, `./locations/${getTodayDate()}/${province.nama}.json`);
    }
}

function getLastChildren(location, obj) {
    let result = []

    switch (location.tingkat) {
        case 1: obj = {provinceCode: location.kode}; break;
        case 2: obj.cityCode = location.kode; break;
        case 3: obj.districtCode = location.kode; break;
        case 4: obj.subdistrictCode = location.kode; break;
        case 5: obj.tpsCode = location.kode; break;
    }

    if(location.children) {
        for (let child of location.children) {
            result.push(...getLastChildren(child, obj));
        }
    }
    else {
        result.push(Object.assign({}, obj));
    }
    return result;
}

function openJson(title) {
    const data = fs.readFileSync(title, 'utf8');
    return JSON.parse(data);
}

async function getAllVoteData() {
    const provinces = openJson(`./provinces.json`);
    for (let province of provinces) {
        const location = openJson(`./locations/${getTodayDate()}/${province.nama}.json`);
        const tpssData = getLastChildren(location);
        const subTpssData = splitArrayIntoSubarrays(tpssData, 300);
        const finalTpssData = [];
        let i = 0;
        for (let locations of subTpssData) {
            let totalRetry = 0;
            const limitRetry = 10;
            while (totalRetry < limitRetry) {
                try {
                    const locationPromises = locations.map(location => getVoteData(location));
                    const result = await Promise.all(locationPromises);
                    finalTpssData.push(...result);
                    console.log(`${province.nama} : ${calculatePercentage(++i, subTpssData.length)}`);
                    break;
                } catch (e) {
                    console.log(`retry(${++totalRetry})`);
                }
            }
        }
        saveFile(finalTpssData, `./result/${getTodayDate()}/${province.nama}.json`);
    }
}

function generateVoteSummary() {
    const provinces = openJson(`./provinces.json`);
    for(let province of provinces) {
        const summary = {
            capres1: 0,
            capres2: 0,
            capres3: 0,
            suaraSah: 0,
            totalCapres: 0,
            different: 0,
        }
        const voteResults = openJson(`./result/${getTodayDate()}/${province.nama}.json`);
        for(let voteResult of voteResults) {
            if(!voteResult.chart || !voteResult.administrasi
                || !voteResult.chart["100025"]
                || !voteResult.chart["100026"]
                || !voteResult.chart["100027"]) continue;
            summary.capres1 += voteResult.chart["100025"];
            summary.capres2 += voteResult.chart["100026"];
            summary.capres3 += voteResult.chart["100027"];
            summary.suaraSah += voteResult.administrasi.suara_sah;
        }
        summary.totalCapres = summary.capres1 + summary.capres2 + summary.capres3;
        summary.different = Math.abs(summary.totalCapres - summary.suaraSah);
        saveFile(summary, `./summary/${getTodayDate()}/${province.nama}.json`);
    }
}

function getWinnerInRegion(summary) {
    const voteNumbers = [summary.capres1, summary.capres2, summary.capres3];
    const maxVoteNumber = Math.max(...voteNumbers);
    const nWinner = voteNumbers.filter(voteNumber => voteNumber === maxVoteNumber).length;
    return nWinner === 1 ? voteNumbers.indexOf(maxVoteNumber) + 1 : 0;
}

function readVoteSummary() {
    const provinces = openJson(`./provinces.json`);
    const summaries = []
    const summaryTotal = {
        capres1: 0,
        capres2: 0,
        capres3: 0,
        suaraSah: 0,
        totalCapres: 0,
        different: 0,
        province: "Total"
    }
    const summaryOrigin = {
        capres1: 0,
        capres2: 0,
        capres3: 0,
        suaraSah: 0,
        totalCapres: 0,
        different: 0,
        province: "Summary Origin"
    }
    const summaryAdjustment = {
        capres1: 0,
        capres2: 0,
        capres3: 0,
        suaraSah: 0,
        totalCapres: 0,
        different: 0,
        province: "Summary Adjustment"
    }

    const winningRegion = {
        capres1: 0,
        capres2: 0,
        capres3: 0,
        suaraSah: 0,
        totalCapres: 0,
        different: 0,
        province: "Winning Region"
    }

    summaries.push(summaryTotal);
    summaries.push(winningRegion);
    summaries.push(summaryOrigin);
    summaries.push(summaryAdjustment);

    let winnerRegions = [];
    for(let province of provinces) {
        const summary = openJson(`./summary/${getTodayDate()}/${province.nama}.json`);
        summary.province = province.nama;
        summaries.push(summary)
        summaryTotal.capres1 += summary.capres1;
        summaryTotal.capres2 += summary.capres2;
        summaryTotal.capres3 += summary.capres3;
        summaryTotal.suaraSah += summary.suaraSah;
        summaryTotal.totalCapres += summary.totalCapres;
        summaryTotal.different += summary.different;
        winnerRegions.push(getWinnerInRegion(summary));
    }

    summaryOrigin.capres1 = formatNumberPercentage(calculatePercentage(summaryTotal.capres1, summaryTotal.totalCapres));
    summaryOrigin.capres2 = formatNumberPercentage(calculatePercentage(summaryTotal.capres2, summaryTotal.totalCapres));
    summaryOrigin.capres3 = formatNumberPercentage(calculatePercentage(summaryTotal.capres3, summaryTotal.totalCapres));
    summaryOrigin.different = formatNumberPercentage(calculatePercentage(summaryTotal.different, summaryTotal.totalCapres));
    summaryOrigin.totalCapres = formatNumberPercentage(calculatePercentage(summaryTotal.totalCapres, summaryTotal.totalCapres));

    summaryAdjustment.capres1 = formatNumberPercentage(calculatePercentage(summaryTotal.capres1, summaryTotal.suaraSah));
    summaryAdjustment.capres2 = formatNumberPercentage(calculatePercentage(summaryTotal.capres2-summaryTotal.different, summaryTotal.suaraSah));
    summaryAdjustment.capres3 = formatNumberPercentage(calculatePercentage(summaryTotal.capres3, summaryTotal.suaraSah));
    summaryAdjustment.suaraSah = formatNumberPercentage(calculatePercentage(summaryTotal.suaraSah, summaryTotal.suaraSah));

    for(let winnerRegion of winnerRegions) {
        switch (winnerRegion) {
            case 1: winningRegion.capres1++; break;
            case 2: winningRegion.capres2++; break;
            case 3: winningRegion.capres3++; break;
        }
    }

    summaryTotal.capres1 = formatNumberPerThousand(summaryTotal.capres1);
    summaryTotal.capres2 = formatNumberPerThousand(summaryTotal.capres2);
    summaryTotal.capres3 = formatNumberPerThousand(summaryTotal.capres3);
    summaryTotal.suaraSah = formatNumberPerThousand(summaryTotal.suaraSah);
    summaryTotal.totalCapres = formatNumberPerThousand(summaryTotal.totalCapres);
    summaryTotal.different = formatNumberPerThousand(summaryTotal.different);

    console.table(summaries);
}

async function getInitLocation() {
    let provinces = await getLocations({ provinceCode : "0" });
    saveFile(provinces, "provinces.json");
}

// get once every election
await getInitLocation();
await getAllLocations();

// get data of today
// better to run multiple nodes / instances for faster result (adjust code by yourself 😀)
// it can take more than 3 hours to complete if using single node / instance ⌛
// **even if your internet speed faster than NASA 🚀
await getAllVoteData();
generateVoteSummary();

// read vote data 📄
readVoteSummary();