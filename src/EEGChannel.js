import EEGTrace from './EEGTrace'
function EEGChannel({ channel}) {
    
    return (
        <div id={channel.electrode}>
        {channel.location} {channel.electrode} {channel.samples.length} <EEGTrace samples={channel.samples.slice(-500)} />

        </div>
    );
}

export default EEGChannel;
