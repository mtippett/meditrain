import React, { useState, useRef } from 'react';
import ElectrodeBandPower from './BandPowerChart';
import AreaBandPower from './AreaBandPower';
import ComparativeBandPower from './ComparativeBandPower';
import BandPowerChart from './BandPowerChart';


function BandPower({ eegData }) {
    const [viewBandPower, setViewBandPower] = useState(false)
    const [allBandPowers, setAllBandPowers] = useState([]);
    const [relativeBandPowers, setRelativeBandPowers] = useState([]);


    const bands_transitions =
        [
            { band: "delta", min: 0.5, max: 4 },
            { band: "theta", min: 4, max: 8 },
            { band: "alpha", min: 8, max: 12 },
            { band: "beta", min: 12, max: 30 },
            { band: "gamma", min: 30, max: 10000 }
        ];


    function calcBandPowers(periodogram) {
        const bandPowers = {};

        let currentBand = 0;
        let totalPower = 0;
        bandPowers[bands_transitions[currentBand].band] = { absolute: 0 };

        periodogram.frequencies.forEach((frequency, index) => {
            if (frequency >= bands_transitions[currentBand].max) {
                currentBand++;
                bandPowers[bands_transitions[currentBand].band] = { absolute: 0 };
            }

            if ((frequency >= bands_transitions[currentBand].min) && (frequency < bands_transitions[currentBand].max)) {
                let power = periodogram.magnitudes[index] ** 2;
                totalPower += power;
                bandPowers[bands_transitions[currentBand].band].absolute += power;
            }
        });

        for (let band in bandPowers) {
            bandPowers[band]["relative"] = bandPowers[band].absolute / totalPower;
        };


        return bandPowers;
    }

    let bandPowers = {};
    eegData.forEach((electrode) => {
        if (typeof electrode.averagedPeriodogram !== 'undefined') {
            electrode.bandPowers = calcBandPowers(electrode.averagedPeriodogram);
            bandPowers[electrode.location.name] = [electrode.bandPowers];

            electrode.location.zones.forEach(zone => {
                if (typeof bandPowers[zone] === 'undefined') {
                    bandPowers[zone] = [];
                }

                bandPowers[zone].push(electrode.bandPowers);
            })
        }
    });

    for (let location in bandPowers) {
        let numElements = bandPowers[location].length;
        let averagedBand = bandPowers[location].reduce((acc, value, index, array) => {

            Object.keys(value).forEach(band => {
                if (typeof acc[band] === 'undefined')
                    acc[band] = 0;

                acc[band] += value[band].relative / numElements;

            })

            return acc;
        }, {});

        if (typeof allBandPowers[location] === 'undefined')
            allBandPowers[location] = {};

        Object.keys(averagedBand).forEach(band => {
            if (typeof allBandPowers[location][band] === 'undefined')
                allBandPowers[location][band] = [];

            allBandPowers[location][band].push(averagedBand[band]);
        })
    }

    if (typeof allBandPowers["left"] !== 'undefined') {
        if (typeof relativeBandPowers["left-right"] === 'undefined') {
            relativeBandPowers["left-right"] = {};
            relativeBandPowers["front-back"] = {};
        }
        // console.log("relative1", relativeBandPowers, "left", allBandPowers["left"],"right",allBandPowers["right"])

        Object.keys(allBandPowers["left"]).forEach(band => {
            if (typeof relativeBandPowers["left-right"][band] === 'undefined') {
                relativeBandPowers["left-right"][band] = [];
                relativeBandPowers["front-back"][band] = [];
            }
            // console.log("relative2", relativeBandPowers, allBandPowers["left"][band].slice(-1), allBandPowers["right"][band].slice(-1))
            relativeBandPowers["left-right"][band].push(allBandPowers["left"][band].slice(-1) - allBandPowers["right"][band].slice(-1));
            relativeBandPowers["front-back"][band].push(allBandPowers["front"][band].slice(-1) - allBandPowers["back"][band].slice(-1));
        });
    }
    // console.log("rbp", relativeBandPowers);

    // setAllBandPowers(allBandPowers);

    return (
        <div>
            <button onClick={() => setViewBandPower(!viewBandPower)}>{viewBandPower ? "Hide" : "View"} Band Power</button>
            {viewBandPower &&
                Object.keys(allBandPowers).map((channel, index, array) => {
                    return (
                        <>
                            {array[index]}
                            <BandPowerChart key={array[index]} channel={{ ...allBandPowers[channel] }} />
                        </>
                    )
                }
                )
            }
            {viewBandPower &&
                Object.keys(relativeBandPowers).map((channel, index, array) => {
                    return (
                        <div>
                            {array[index]}
                            <BandPowerChart key={array[index]} channel={{ ...relativeBandPowers[channel] }} />
                        </div>
                    )
                }
                )
            }
        </div >
    );
}

export default BandPower;
