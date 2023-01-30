import React, { useState, useEffect, useRef } from 'react';
import EEGChannels from './EEGChannels';
import MuseData from './MuseData';
import { fft, util as fftUtil } from "fft-js"


function DeviceControl({onPeriodgramUpdated}) {

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
                            electrode.averagedPeriodograms = averagePeriodogram(electrode.periodograms);

                            onPeriodgramUpdated(eegChannelData.current);
                        }
                    });
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
            console.log("setting maps", channelMaps, [...maps])
            channelMaps.current = maps;

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
        const averagedPeriodogram = {frequencies: periodograms[0].frequencies, magnitudes: []}
        const numPeriodograms = periodograms.length;

        // Use periodogram[0], as a template and average across all 
        periodograms[0].magnitudes.forEach((element, index) => {
            let sum = 0;
            for (let i = 0; i < numPeriodograms; i++) {
                sum += periodograms[i].magnitudes[index];
            }
            averagedPeriodogram.magnitudes[index] = sum/numPeriodograms;
        });

        // console.log("av", averagedPeriodogram);
        return averagedPeriodogram;
        
    }

    function calcPeriodogram(eegData) {

        // Define the sampling rate and frequency bands
        const samplingRate = 256;
        const lowerFrequency = 8;
        const upperFrequency = 12;

        // Filter the data to remove unwanted noise
        // const filteredData = filterData(eegData);
        const filteredData = eegData;

        // Perform the FFT on the filtered data
        const phasors = fft(eegData);

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
                    <button onClick={() => setViewEEG(!viewEEG)}>View EEG Data</button>
                }
                {viewEEG &&
                    <EEGChannels eegChannelData={eegChannelData.current} />
                }
            </div>
        </div>
    );
}

export default DeviceControl;
