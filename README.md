# EEG Power Bands Monitor and Operant Conditioning for Meditation

This project is a web-based application monitoring and targetting particular 
EEG power bands ratios during meditation.  It uses  operant conditioning 
methods to help target particular band powers. The application interfaces 
with an EEG device to receive real-time EEG data, and displays the EEG power 
bands (Delta, Theta, Alpha, Beta, Gamma) on a dashboard.

Users can set target power ranges for each band, and the application 
will provide real-time feedback on the current power levels and whether 
they are within the target ranges. Users can also receive rewards (e.g.
visual feedback or audio cues) when their power levels fall within the 
target ranges, providing positive reinforcement for maintaining the desired 
power states.

The application is designed to be used for EEG biofeedback training during 
meditation or other mindfulness practices. By targeting specific EEG power 
bands associated with relaxation, focus, and other mental states, users can 
train their brains to achieve these states more easily over time.

## Getting Started

To use this application, you will need an EEG device that can interface with 
the application. The application has been tested with the 
[Muse 2 EEG Headband](https://choosemuse.com/muse-2/), but it may work with 
other EEG devices as well.

To set up the application:

1. Clone the repository to your local machine.
2. Install the required dependencies by running `npm install` in the project directory.
3. Connect your EEG device to your computer and ensure that it is paired and working properly.
4. Start the application by running `npm start` in the project directory.
5. Open the application in your web browser by navigating to `http://localhost:3000/`.

Once the application is running, you should see the EEG power bands 
dashboard and be able to set target power ranges and receive real-time 
feedback on your power levels.

## Documentation

Docs are in the [docs](docs) directory.

## Contributing

This project is open source and contributions are welcome! If you have ideas 
for new features or improvements, feel free to submit a pull request or open 
an issue.

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for more information.
