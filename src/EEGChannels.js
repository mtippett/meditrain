import EEGChannel from './EEGChannel';

function EEGChannels({ eegChannelData }) {

    return (
        <div >
            <div>
                {eegChannelData.map((channel) =>
                    <EEGChannel key={channel.electrode} channel={channel} />
                )}
            </div>

        </div>
    );
}

export default EEGChannels;
