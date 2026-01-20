import { fft, util as fftUtil } from "fft-js"


export function averagedPeriodogram(periodograms) {
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

export function filterEEGData(eegData) {
    return eegData;
}
export function calcPeriodogram(eegData) {

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

