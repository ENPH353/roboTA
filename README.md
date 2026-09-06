# roboTA

roboTA is a local application that uses python with Flask to host an HTML frontend on Firefox. This application lets students create chats within project folders and submit their project chat history for submission in the ENPH 353 course.

roboTA can recieve outputs from both a local ollama phi4:mini model, and via API call from UBC's on-premise LiteLLM service that has qwen3.6-35b.

## Installing roboTA

1) Install local LLMs
```
curl -fsSL https://ollama.com/install.sh | sh
ollama pull phi4-mini
```
2) Clone this repository
```
git clone https://github.com/ENPH353/roboTA.git
```
3) Create environment and install dependencies
```
cd roboTA
python3 -m venv roboTA_venv
source roboTA_venv/bin/activate
pip install -r requirements.txt
```
4) Start roboTA
```
./start.sh
```
- Or you can drag and drop the *roboTA.desktop* file to your desktop and double click it.

## Stopping roboTA
- To terminate roboTA, close it's firefox tab and run the following command from the roboTA folder:
```
./stop.sh
```
- This command terminates any process listening or using TCP port 5000 (which is the port that the roboTA flask service uses)
