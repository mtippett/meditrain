import React, { useState, useEffect, useRef } from 'react';
import EEGChannelView from "./EEGChannelView";
import FFT from 'fft-js';



function EEGChannel({ channel, newSamples }) {
    const [samples, setSamples] = useState([]);
    const _currentSamples = useRef([]);

    useEffect(() => {
        const interval = setInterval(() => {
            setSamples(_currentSamples.current);
        }, 1000);
        return () => clearInterval(interval);
    }, [samples]);

    _currentSamples.current.push(...newSamples);

    // Define the sample rate and the band frequencies
    const sampleRate = 128;
    const bands = {
        delta: [0.5, 4],
        theta: [4, 8],
        alpha: [8, 12],
        beta: [12, 30]
    };

    // Initialize an empty object to store the band powers
    let bandPowers = {};

    // Iterate over the bands
    for (let band in bands) {
        // Initialize the band power variable
        let bandPower = 0;
        // Apply a window function to the EEG data
        let windowedData = FFT.applyWindow(_currentSamples.current);
        // Perform a fast Fourier transform (FFT) on the windowed data
        let fftData = FFT.fft(windowedData);
        // Extract the magnitude of the FFT data
        let fftMag = fftData.map(x => x.r ** 2 + x.i ** 2);
        // Calculate the power of the band by summing the magnitudes within the band
        for (let i = bands[band][0] * fftMag.length / sampleRate; i < bands[band][1] * fftMag.length / sampleRate; i++) {
            bandPower += fftMag[i];
        }
        // Normalize the band power by the length of the data
        bandPower /= _currentSamples.current.length;
        // Add the band power to the bandPowers object
        bandPowers[band] = bandPower;
    }

    console.log(bandPowers);

    return (
        <div key={channel}>
            {_currentSamples.current.length}
            <EEGChannelView samples={samples} channel_name={channel} />
        </div>
    );
}

export default EEGChannel;
