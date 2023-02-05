import React, { useState, useEffect, useRef } from 'react';
import EEGChannels from './EEGChannels';
import MuseData from './MuseData';
import { fft, util as fftUtil } from "fft-js"



// zones are left/right, front/back, frontal/temporal/parietal
// names for 10-10 (due to muse)
const electrodeMap_10_10 = {
    "AF7": { name: "AF7", zones: ["left", "front", "frontal"] },
    "AF8": { name: "AF8", zones: ["right", "front", "frontal"] },
    "TP9": { name: "TP9", zones: ["left", "back", "parietal", "temporal"] },
    "TP10": { name: "TP10", zones: ["right", "back", "parietal", "temporal"] },
    "C3": { name: "C3", zones: ["left", "back", "frontal", "temporal"] },
    "C4": { name: "C4", zones: ["right", "back", "frontal", "temporal"] },
    "AUXL": { name: "AUXL", zones: [] },
    "AUXR": { name: "AUXR", zones: [] }
}

function DeviceControl({ onPeriodgramUpdated }) {

    const eegChannelData = useRef([]);
    const channelMaps = useRef([]);

    const [updater, setUpdater] = useState(0);
    const [viewEEG, setViewEEG] = useState(false)
    const eegInterval = useRef(0);
    const powerInterval = useRef(0);


    useEffect(
        () => {
            if (powerInterval.current === 0 && channelMaps.current.length !== 0) {

                powerInterval.current = setInterval(() => {
                    eegChannelData.current.forEach(electrode => {
                        if (electrode.samples.length > 1024) {
                            electrode.periodograms.push(calcPeriodogram(electrode.samples.slice(-1024)));
                            electrode.periodograms = electrode.periodograms.slice(-4);
                            electrode.averagedPeriodogram = averagePeriodogram(electrode.periodograms);

                        }
                    });
                    onPeriodgramUpdated(eegChannelData.current);
                }, 1000);
            }
            if (viewEEG) {
                eegInterval.current = setInterval(() => {
                    setUpdater(updater + 1);
                }, 100);
            }
            return function cleanup() {
                clearInterval(eegInterval.current);
            };

        },
        [updater, viewEEG]
    );

    function updateChannelMaps(maps) {
        if (channelMaps.current.length === 0) {

            maps.forEach(map => {
                channelMaps.current.push(electrodeMap_10_10[map])
            });
            setUpdater(updater + 1);
        }
    }



    function onNewData(data) {
        // console.log(data);
        let currentChannel = eegChannelData.current[data.electrode];
        if (typeof currentChannel === 'undefined') {
            eegChannelData.current[data.electrode] =
            {
                electrode: data.electrode,
                location: channelMaps.current[data.electrode],
                samples: [],
                periodograms: []
            }
        }

        const samples = eegChannelData.current[data.electrode].samples
        samples.push(...data.samples);
        eegChannelData.current[data.electrode].samples = samples.slice(-4096)

    }

    function averagePeriodogram(periodograms) {
        const averagedPeriodogram = { frequencies: periodograms[0].frequencies, magnitudes: [] }
        const numPeriodograms = periodograms.length;

        // Use periodogram[0], as a template and average across all 
        periodograms[0].magnitudes.forEach((element, index) => {
            let sum = 0;
            for (let i = 0; i < numPeriodograms; i++) {
                sum += periodograms[i].magnitudes[index];
            }
            averagedPeriodogram.magnitudes[index] = sum / numPeriodograms;
        });

        // console.log("av", averagedPeriodogram);
        return averagedPeriodogram;

    }

    function filterEEGData(eegData) {
        return eegData;
    }
    function calcPeriodogram(eegData) {

        // Define the sampling rate and frequency bands
        const samplingRate = 256;

        // Filter the data to remove unwanted noise
        // const filteredData = filterData(eegData);
        const filteredData = filterEEGData(eegData);

        // Perform the FFT on the filtered data
        const phasors = fft(filteredData);

        const frequencies = fftUtil.fftFreq(phasors, samplingRate);
        const magnitudes = fftUtil.fftMag(phasors);

        var both = { frequencies: frequencies, magnitudes: magnitudes }

        return both;
    }

    return (
        <div>
            <div>
                DeviceControl
            </div>
            <div>
                <MuseData onNewData={onNewData} updateChannelMaps={updateChannelMaps} />
                {channelMaps.current.length !== 0 &&
                    <button onClick={() => setViewEEG(!viewEEG)}>{viewEEG?"Hide":"View"} EEG Data</button>
                }
                {viewEEG &&
                    <EEGChannels eegChannelData={eegChannelData.current} />
                }
            </div>
        </div>
    );
}

export default DeviceControl;
