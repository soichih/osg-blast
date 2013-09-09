#!/usr/bin/python

import sys
import os
import time
import shutil
import glob

if len(sys.argv) != 6:
    print "#arg: project_name db queries blast_type \"blast_opt\""
    sys.exit(1)

project=sys.argv[1]
dbname=sys.argv[2]
query_path=sys.argv[3]
blast_type=sys.argv[4]
user_blast_opt=sys.argv[5]

block_size=412

db_dir = "/local-scratch/public_html/hayashis/blastdb/"+dbname
blast_bin = "/home/hayashis/app/ncbi-blast-2.2.28+/bin"
rundir = "/local-scratch/hayashis/rundir/"+str(time.time())
if os.path.exists(rundir):
    print "#rundir already exists.."
    sys.exit(1)
else:
    os.makedirs(rundir)

os.mkdir(rundir+"/log")
os.mkdir(rundir+"/output")

#parse input query
input = open(query_path)
queries = []
query = ""
name = ""
for line in input.readlines():
    if line[0] == ">":
        if name != "":
            queries.append([name, query])
        name = line
        query = ""
    else:
        query += line
if name != "":
    queries.append([name, query])
input.close()

#split queries into blocks
inputdir=rundir+"/input"
os.makedirs(inputdir)
block = {}
count = 0
block = 0
for query in queries:
    if count == 0:
        if block != 0:
            outfile.close() 
        outfile = open("%s/block_%d" % (inputdir, block), "w")
        block+=1
    count+=1
    if count == block_size:
        count = 0

    outfile.write(query[0])
    outfile.write(query[1])
if outfile:
    outfile.close()

dbparts = glob.glob(db_dir+"/*.gz")

#I don't know how to pass double quote escaped arguments via condor arguemnts option
#so let's pass via writing out to file.
#we need to concat user blast opt to db blast opt
db_blast_opt = file(db_dir+"/blast.opt", "r").read().strip()
blast_opt = file(rundir+"/blast.opt", "w")
blast_opt.write(db_blast_opt)
blast_opt.write(" "+user_blast_opt)
blast_opt.close()

#output condor submit file for running blast
dag = open(rundir+"/blast.dag", "w")
for query_block in os.listdir(inputdir):

    sub_name = query_block+".sub"
    sub = open(rundir+"/"+sub_name, "w")
    sub.write("universe = vanilla\n")
    sub.write("notification = never\n")
    sub.write("ShouldTransferFiles = YES\n")
    sub.write("when_to_transfer_output = ON_EXIT\n\n")

    #not sure if this helps or not..
    #sub.write("request_memory = 500\n\n") #in megabytes
    #sub.write("request_disk = 256000\n\n") #in kilobytes

    #per derek.. to restart long running jobs 
    sub.write("periodic_release = ( ( CurrentTime - EnteredCurrentStatus ) > 60 )\n")
    sub.write("periodic_hold = ( ( CurrentTime - EnteredCurrentStatus ) > 9000 ) && JobStatus == 2\n") #9000 should be enough for 412 queries

    #sub.write("periodic_remove = (CommittedTime - CommittedSuspensionTime) > 7200\n") #not sure if this works

    #sub.write("periodic_remove = (ServerTime - JobCurrentStartDate) >= 7200\n") #not sure if this works
    #above doesn't work... seem to be killing jobs left and right, and.. also seeing following
    #012 (38534006.002.000) 08/31 13:29:19 Job was held.
    #    The job attribute PeriodicRemove expression '( ServerTime - JobCurrentStartDate ) >= 7200' evaluated to UNDEFINED
    #    Code 5 Subcode 0

    sub.write("executable = blast_wrapper.sh\n")
    sub.write("output = log/"+query_block+".part_$(Process).out\n")
    sub.write("error = log/"+query_block+".part_$(Process).err\n")
    sub.write("log = log/"+query_block+".log\n")
    sub.write("+ProjectName = \""+project+"\"\n")
    sub.write("transfer_output_files = output\n");

    #TODO - I should probably compress blast executable and input query block?
    sub.write(
        "transfer_input_files = "+blast_bin+"/"+blast_type+","+
        "http://osg-xsede.grid.iu.edu/scratch/hayashis/blastdb/"+dbname+"/"+dbname+".$(Process).tar.gz,"+
        "blast.opt,"+
        "input/"+query_block+"\n")
    sub.write("arguments = "+blast_type+" "+query_block+" "+dbname+" $(Process) output/"+query_block+".part_$(Process).result\n\n");

    sub.write("queue "+str(len(dbparts))+"\n")
    sub.close()

    #copy blast_wrapper.sh
    shutil.copy("blast_wrapper.sh", rundir)

    #copy merge.py
    shutil.copy("merge.py", rundir)

    msub_name = query_block+".merge.sub"
    msub = open(rundir+"/"+msub_name, "w")
    msub.write("universe = local\n")
    msub.write("notification = never\n")
    msub.write("executable = merge.py\n")
    msub.write("arguments = "+query_block+"\n")
    msub.write("output = log/"+query_block+".merge.out\n")
    msub.write("error = log/"+query_block+".merge.err\n")
    msub.write("log = log/"+query_block+".merge.log\n")
    msub.write("queue\n")

    dag.write("JOB "+query_block+" "+sub_name+"\n")
    dag.write("RETRY "+query_block+" 10\n")
    dag.write("JOB "+query_block+".merge "+msub_name+"\n")
    dag.write("PARENT "+query_block+" CHILD "+query_block+".merge\n")

dag.close()

print "#Run workflow by executing.."
print "cd "+rundir+" && condor_submit_dag blast.dag && condor_wait blast.dag.dagman.log"
