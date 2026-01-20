import EEGChannel from './EEGChannel';

function EEGChannels({ eegChannelData, showPeriodograms = true }) {
  const channels = eegChannelData.filter(Boolean);

  return (
    <div>
      <div>
        {channels.map((channel) =>
          <EEGChannel key={channel.electrode} channel={channel} showPeriodograms={showPeriodograms} />
        )}
      </div>
    </div>
  );
}

export default EEGChannels;
